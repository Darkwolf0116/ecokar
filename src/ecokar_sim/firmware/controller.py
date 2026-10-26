"""Faithful port of ``arduino/carrito_bt_mega/carrito_bt_mega.ino``.

The sketch runs a non-blocking ``loop()``; here :meth:`FirmwareController.tick`
advances the emulated ``millis()`` clock and executes exactly one pass of that loop:

1. consume received characters (``procesarComando``),
2. dead-man timeout (``TIMEOUT_COMANDO_MS``),
3. speed ramp (``RAMPA_PASO`` every ``RAMPA_INTERVALO_MS``).

On top of the sketch, the arm letters E..L set a jog direction per joint. They leave
the drive untouched and refresh the watchdog, so a held arm button keeps working under
the same dead-man rule. The serial monitor lines are Spanish, as in the sketch.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass

from .. import config
from ..bluetooth.protocol import (
    ARM,
    ARM_JOG_BINDINGS,
    LOCOMOTION,
    STOP,
    Command,
    parse_char,
)

JOINTS: tuple[str, ...] = ("base", "shoulder", "elbow", "gripper")

# Joint names as printed on the serial monitor (Spanish).
_JOINT_LABEL_ES = {
    "base": "base",
    "shoulder": "hombro",
    "elbow": "codo",
    "gripper": "pinza",
    "ground": "suelo",
}


@dataclass
class MotorSide:
    """Port of the sketch's ``LadoMotor`` plus the L298N pins it drives."""

    name: str
    inverted: bool
    actual: int = 0  # applied speed, -PWM_MAX..+PWM_MAX
    target: int = 0  # desired speed, -PWM_MAX..+PWM_MAX
    en: int = 0  # ENA / ENB (PWM duty 0..255)
    in_a: int = 0  # IN1 / IN3
    in_b: int = 0  # IN2 / IN4


@dataclass(frozen=True)
class L298NPins:
    """Logic levels on the L298N control pins."""

    ENA: int
    IN1: int
    IN2: int
    ENB: int
    IN3: int
    IN4: int

    def as_dict(self) -> dict[str, int]:
        return {
            "ENA": self.ENA,
            "IN1": self.IN1,
            "IN2": self.IN2,
            "ENB": self.ENB,
            "IN3": self.IN3,
            "IN4": self.IN4,
        }


@dataclass(frozen=True)
class SerialLine:
    """One line printed on the USB serial monitor, with the emulated millis()."""

    t_ms: int
    text: str


def _clamp_pwm(value: int) -> int:
    return max(-config.PWM_MAX, min(config.PWM_MAX, value))


class FirmwareController:
    """Emulates the Arduino Mega sketch (drive + the proposed arm extension)."""

    def __init__(self) -> None:
        self.left = MotorSide("left", config.INVERT_LEFT)
        self.right = MotorSide("right", config.INVERT_RIGHT)
        self.now_ms = 0  # emulated millis()
        self.last_command_ms = 0  # ultimoComandoMs
        self.last_ramp_ms = 0  # ultimaRampaMs
        self.command = "S"  # comandoActual (locomotion command, as in the sketch)
        self.jog: dict[str, int] = dict.fromkeys(JOINTS, 0)  # -1 | 0 | +1 per joint
        self._rx: deque[tuple[int, str]] = deque()  # (arrival millis, character)
        self._serial: list[SerialLine] = []
        self._stop_immediately()  # setup(): leave the H-bridge in a safe state

    # ------------------------------------------------------------------ outputs
    @property
    def left_pwm(self) -> int:
        return self.left.actual

    @property
    def right_pwm(self) -> int:
        return self.right.actual

    @property
    def left_target(self) -> int:
        return self.left.target

    @property
    def right_target(self) -> int:
        return self.right.target

    @property
    def pins(self) -> L298NPins:
        return L298NPins(
            ENA=self.left.en,
            IN1=self.left.in_a,
            IN2=self.left.in_b,
            ENB=self.right.en,
            IN3=self.right.in_a,
            IN4=self.right.in_b,
        )

    def has_target(self) -> bool:
        """Sketch ``hayObjetivo()``: movement requested (ramp may not have arrived)."""
        return self.left.target != 0 or self.right.target != 0

    def is_active(self) -> bool:
        """True if the drive has a target or any arm joint is being jogged."""
        return self.has_target() or any(self.jog.values())

    # ------------------------------------------------------------------- inputs
    def feed(self, text: str) -> None:
        """Queue characters received over Bluetooth, stamped with their arrival time.

        The real ``loop()`` runs thousands of times per emulated tick, so a character is
        handled (and ``ultimoComandoMs`` set) practically at the moment it arrives.
        """
        self._rx.extend((self.now_ms, char) for char in text)

    def tick(self, dt_ms: int = config.RAMP_INTERVAL_MS) -> None:
        """Advance the emulated clock by ``dt_ms`` and run one pass of ``loop()``."""
        self.now_ms += dt_ms
        self._loop()

    # ---------------------------------------------------------------- bluetooth
    def bt_connected(self) -> None:
        """Serial lines shown when a Bluetooth link comes up."""
        self._print(config.SETUP_BANNER)
        self._print("[BT] Conectado")

    def bt_disconnected(self) -> None:
        """The sketch runs with USAR_PIN_STATE 0: a lost link does NOT stop the car."""
        self._print("[BT] Desconectado")

    def report_arm_limit(self, joint: str) -> None:
        """Print a limit hit; ``joint`` is a joint name or ``"ground"``."""
        self._print(f"[BRAZO] Límite {_JOINT_LABEL_ES.get(joint, joint)}")

    def drain_serial(self) -> list[SerialLine]:
        lines, self._serial = self._serial, []
        return lines

    # ----------------------------------------------------------------- the loop
    def _loop(self) -> None:
        while self._rx:
            arrival_ms, char = self._rx.popleft()
            self._process(char, arrival_ms)

        now = self.now_ms

        # 4) safety: no commands for too long
        if (
            config.COMMAND_TIMEOUT_MS > 0
            and self.is_active()
            and now - self.last_command_ms > config.COMMAND_TIMEOUT_MS
        ):
            self._stop()
            self.command = "S"
            self._print("[SEG] Timeout de comando: parada")

        # 5) speed ramp
        if now - self.last_ramp_ms >= config.RAMP_INTERVAL_MS:
            self.last_ramp_ms = now
            self._update_ramp(self.left)
            self._update_ramp(self.right)

    def _process(self, received: str, arrival_ms: int) -> None:
        """Sketch ``procesarComando``."""
        command = parse_char(received)
        if command is None:
            return  # '\r', '\n', spaces or garbage: ignored without changing state

        if command in LOCOMOTION:
            self._set_locomotion(command)
        elif command in STOP:
            self._stop()
        elif command in ARM:
            self._set_arm_jog(command)

        self.last_command_ms = arrival_ms

        if command in LOCOMOTION or command in STOP:
            char = command.value
            if char != self.command:
                self.command = char
                self._print(f"[CMD] {char}")

    # -------------------------------------------------------------- primitives
    def _set_target(self, left: int, right: int) -> None:
        self.left.target = _clamp_pwm(left)
        self.right.target = _clamp_pwm(right)

    def _set_locomotion(self, command: Command) -> None:
        drive, spin = config.DRIVE_PWM, config.SPIN_PWM
        trim_l, trim_r = config.TRIM_LEFT_PWM, config.TRIM_RIGHT_PWM
        if command is Command.FORWARD:
            self._set_target(drive + trim_l, drive + trim_r)
        elif command is Command.BACKWARD:
            self._set_target(-(drive + trim_l), -(drive + trim_r))
        elif command is Command.SPIN_LEFT:
            self._set_target(-(spin + trim_l), spin + trim_r)
        elif command is Command.SPIN_RIGHT:
            self._set_target(spin + trim_l, -(spin + trim_r))

    def _stop(self) -> None:
        """Soft stop of everything: drive ramps to 0, arm jogs are cleared."""
        self._set_target(0, 0)
        for joint in JOINTS:
            self.jog[joint] = 0

    def _stop_immediately(self) -> None:
        """Sketch ``detenerInmediato``: no ramp, outputs written at once."""
        for side in (self.left, self.right):
            side.target = 0
            side.actual = 0
            self._apply_output(side)

    def _set_arm_jog(self, command: Command) -> None:
        joint, direction = ARM_JOG_BINDINGS[command]
        if self.jog[joint] != direction:
            self.jog[joint] = direction
            self._print(f"[BRAZO] {command.value}")

    @staticmethod
    def _apply_output(side: MotorSide) -> None:
        """Sketch ``aplicarSalida``: direction pins + PWM (coast when speed is 0)."""
        v = -side.actual if side.inverted else side.actual
        if v > 0:
            side.in_a, side.in_b = 1, 0
        elif v < 0:
            side.in_a, side.in_b = 0, 1
        else:
            side.in_a, side.in_b = 0, 0
        side.en = abs(v)

    def _update_ramp(self, side: MotorSide) -> None:
        """Sketch ``actualizarRampa``: one ramp step; reversals stop at 0 for one tick."""
        if side.actual == side.target:
            return

        step = config.RAMP_STEP_PWM
        if side.actual < side.target:
            following = min(side.actual + step, side.target)
        else:
            following = max(side.actual - step, side.target)

        if (side.actual > 0 and following < 0) or (side.actual < 0 and following > 0):
            following = 0

        side.actual = following
        self._apply_output(side)

    def _print(self, text: str) -> None:
        self._serial.append(SerialLine(self.now_ms, text))
