import pytest

from ecokar_sim import config
from ecokar_sim.firmware.controller import FirmwareController
from helpers import lines_of, tick_firmware

TIMEOUT_LINE = "[SEG] Timeout de comando: parada"


def test_boot_state_is_safe():
    fw = FirmwareController()
    pins = fw.pins.as_dict()
    assert pins == {"ENA": 0, "IN1": 0, "IN2": 0, "ENB": 0, "IN3": 0, "IN4": 0}
    assert fw.command == "S"
    assert lines_of(fw) == []


def test_ramp_reaches_target_in_exactly_140_ms():
    fw = FirmwareController()
    fw.feed("A")
    tick_firmware(fw, 13)
    assert fw.left_pwm == fw.right_pwm == 195  # 13 steps of 15
    tick_firmware(fw, 1)
    assert fw.left_pwm == fw.right_pwm == config.DRIVE_PWM
    assert fw.now_ms == 140


def test_ramp_steps_are_fifteen_pwm_per_ten_ms():
    fw = FirmwareController()
    fw.feed("A")
    seen = []
    for _ in range(5):
        tick_firmware(fw, 1)
        seen.append(fw.left_pwm)
    assert seen == [15, 30, 45, 60, 75]


def test_forward_pins_and_pwm():
    fw = FirmwareController()
    fw.feed("A")
    tick_firmware(fw, 20)
    assert fw.pins.as_dict() == {"ENA": 200, "IN1": 1, "IN2": 0, "ENB": 200, "IN3": 1, "IN4": 0}


def test_backward_pins_and_pwm():
    fw = FirmwareController()
    fw.feed("B")
    tick_firmware(fw, 20)
    assert fw.left_pwm == fw.right_pwm == -200
    assert fw.pins.as_dict() == {"ENA": 200, "IN1": 0, "IN2": 1, "ENB": 200, "IN3": 0, "IN4": 1}


def test_spin_targets_use_spin_pwm():
    fw = FirmwareController()
    fw.feed("C")
    tick_firmware(fw, 1)
    assert (fw.left_target, fw.right_target) == (-config.SPIN_PWM, config.SPIN_PWM)
    fw.feed("D")
    tick_firmware(fw, 1)
    assert (fw.left_target, fw.right_target) == (config.SPIN_PWM, -config.SPIN_PWM)


def test_reversal_passes_through_zero():
    fw = FirmwareController()
    fw.feed("A")
    tick_firmware(fw, 20)
    fw.feed("B")
    history = []
    for _ in range(40):
        tick_firmware(fw, 1)
        history.append(fw.left_pwm)
    zero_at = history.index(0)
    assert all(value > 0 for value in history[:zero_at])
    assert all(value <= 0 for value in history[zero_at:])
    assert history[-1] == -config.DRIVE_PWM
    # no sign flip without a 0 sample in between
    for before, after in zip(history, history[1:], strict=False):
        assert not (before > 0 and after < 0)
    # at zero the bridge coasts (both direction pins low)
    probe = FirmwareController()
    probe.feed("A")
    tick_firmware(probe, 20)
    probe.feed("B")
    while probe.left_pwm != 0:
        tick_firmware(probe, 1)
    assert (probe.pins.IN1, probe.pins.IN2, probe.pins.ENA) == (0, 0, 0)


def test_command_is_printed_only_when_it_changes():
    fw = FirmwareController()
    for _ in range(5):
        fw.feed("A")
        tick_firmware(fw, 1)
    fw.feed("b")
    tick_firmware(fw, 1)
    fw.feed("S")
    tick_firmware(fw, 1)
    assert lines_of(fw) == ["[CMD] A", "[CMD] B", "[CMD] S"]


def test_stop_when_already_stopped_prints_nothing():
    fw = FirmwareController()
    fw.feed("S0")
    tick_firmware(fw, 1)
    assert lines_of(fw) == []


def test_garbage_does_not_change_state_or_watchdog():
    fw = FirmwareController()
    fw.feed("A")
    tick_firmware(fw, 5)
    lines_of(fw)
    fw.feed("\r\n x?!")
    tick_firmware(fw, 1)
    assert fw.command == "A"
    assert fw.left_target == config.DRIVE_PWM
    assert lines_of(fw) == []


def test_zero_char_stops():
    fw = FirmwareController()
    fw.feed("A")
    tick_firmware(fw, 20)
    fw.feed("0")
    tick_firmware(fw, 30)
    assert fw.left_pwm == fw.right_pwm == 0
    assert fw.command == "S"


def test_timeout_stops_after_400_ms_and_prints_sketch_line():
    fw = FirmwareController()
    fw.feed("A")
    tick_firmware(fw, 40)  # 400 ms after the command: not yet "> 400"
    assert fw.left_target == config.DRIVE_PWM
    assert TIMEOUT_LINE not in lines_of(fw)
    tick_firmware(fw, 1)  # 410 ms
    assert fw.left_target == fw.right_target == 0
    assert fw.command == "S"
    assert lines_of(fw) == [TIMEOUT_LINE]
    tick_firmware(fw, 60)
    assert fw.left_pwm == fw.right_pwm == 0
    assert lines_of(fw) == []  # printed once, not repeatedly


def test_repeating_the_letter_every_100_ms_keeps_moving():
    fw = FirmwareController()
    for tick in range(300):  # 3 s
        if tick % 10 == 0:
            fw.feed("A")
        tick_firmware(fw, 1)
    assert fw.left_pwm == fw.right_pwm == config.DRIVE_PWM
    assert TIMEOUT_LINE not in lines_of(fw)


def test_timeout_ramps_down_smoothly():
    fw = FirmwareController()
    fw.feed("A")
    tick_firmware(fw, 41)
    assert fw.left_target == 0
    assert fw.left_pwm == config.DRIVE_PWM - config.RAMP_STEP_PWM  # ramping down, not cut
    tick_firmware(fw, 13)
    assert fw.left_pwm == 0


def test_inverted_side_swaps_direction_pins(monkeypatch):
    monkeypatch.setattr(config, "INVERT_LEFT", True)
    fw = FirmwareController()
    fw.feed("A")
    tick_firmware(fw, 20)
    pins = fw.pins
    assert fw.left_pwm == config.DRIVE_PWM  # logical direction unchanged
    assert (pins.IN1, pins.IN2) == (0, 1)  # but the pins are swapped
    assert (pins.IN3, pins.IN4) == (1, 0)


def test_bluetooth_lines():
    fw = FirmwareController()
    fw.bt_connected()
    fw.bt_disconnected()
    assert lines_of(fw) == [
        "Carrito BT listo. Comandos: A B C D S",
        "[BT] Conectado",
        "[BT] Desconectado",
    ]


# --------------------------------------------------------------------- arm extension
def test_arm_letter_sets_jog_prints_once_and_keeps_drive():
    fw = FirmwareController()
    fw.feed("A")
    tick_firmware(fw, 20)
    lines_of(fw)
    for _ in range(3):
        fw.feed("E")
        tick_firmware(fw, 1)
    assert fw.jog["elbow"] == 1
    assert fw.left_target == config.DRIVE_PWM  # drive untouched
    assert lines_of(fw) == ["[BRAZO] E"]


@pytest.mark.parametrize(
    ("char", "joint", "direction"),
    [
        ("E", "elbow", 1),
        ("F", "elbow", -1),
        ("G", "base", 1),
        ("H", "base", -1),
        ("I", "shoulder", -1),
        ("J", "shoulder", 1),
        ("K", "gripper", 1),
        ("L", "gripper", -1),
    ],
)
def test_arm_letter_jog_directions(char, joint, direction):
    fw = FirmwareController()
    fw.feed(char.lower())
    tick_firmware(fw, 1)
    assert fw.jog[joint] == direction
    assert sum(abs(v) for v in fw.jog.values()) == 1
    assert lines_of(fw) == [f"[BRAZO] {char}"]


def test_arm_letters_refresh_the_watchdog():
    fw = FirmwareController()
    fw.feed("A")
    for tick in range(100):  # 1 s of E every 100 ms and no more A
        if tick % 10 == 0:
            fw.feed("E")
        tick_firmware(fw, 1)
    assert fw.left_target == config.DRIVE_PWM
    assert TIMEOUT_LINE not in lines_of(fw)


def test_stop_clears_every_jog():
    fw = FirmwareController()
    fw.feed("EGK")
    tick_firmware(fw, 1)
    assert any(fw.jog.values())
    fw.feed("S")
    tick_firmware(fw, 1)
    assert not any(fw.jog.values())


def test_timeout_also_stops_arm_jogs():
    fw = FirmwareController()
    fw.feed("E")
    tick_firmware(fw, 41)
    assert not any(fw.jog.values())
    assert lines_of(fw) == ["[BRAZO] E", TIMEOUT_LINE]


def test_limit_line_uses_spanish_joint_names():
    fw = FirmwareController()
    for joint in ("base", "shoulder", "elbow", "gripper", "ground"):
        fw.report_arm_limit(joint)
    assert lines_of(fw) == [
        "[BRAZO] Límite base",
        "[BRAZO] Límite hombro",
        "[BRAZO] Límite codo",
        "[BRAZO] Límite pinza",
        "[BRAZO] Límite suelo",
    ]
