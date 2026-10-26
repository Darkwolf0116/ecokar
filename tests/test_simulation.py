import json

import pytest

from ecokar_sim import config
from ecokar_sim.simulation import Simulation
from helpers import connected_sim, events, hold, serial_lines

TIMEOUT_LINE = "[SEG] Timeout de comando: parada"

HELLO_KEYS = {"type", "version", "world", "robot", "protocol"}
WORLD_KEYS = {
    "road",
    "sidewalk_width",
    "curb_height",
    "obstacles",
    "crate",
    "decor",
    "trash",
}
ROBOT_SPEC_KEYS = {
    "plate_length",
    "plate_width",
    "plate_y",
    "wheel_radius",
    "wheel_width",
    "track",
    "wheelbase",
    "collision_radius",
    "v_max",
    "arm_mount",
    "shoulder_height",
    "l1",
    "l2",
    "grasp_offset",
    "gripper_max_opening",
    "home",
    "limits",
}
STATE_KEYS = {"type", "t", "connected", "robot", "drive", "arm", "trash", "mission", "battery"}


def test_hello_contract():
    hello = Simulation().hello()
    assert set(hello) == HELLO_KEYS
    assert hello["type"] == "hello"
    assert hello["version"] == 1
    assert set(hello["world"]) == WORLD_KEYS
    assert set(hello["world"]["road"]) == {"x_min", "x_max", "z_min", "z_max"}
    assert set(hello["world"]["crate"]) == {"x", "z", "yaw", "w", "d", "h", "wall"}
    for obstacle in hello["world"]["obstacles"]:
        assert set(obstacle) == {"id", "kind", "x", "z", "yaw", "w", "d", "h"}
    assert set(hello["robot"]) == ROBOT_SPEC_KEYS
    assert set(hello["robot"]["limits"]) == {
        "base_deg",
        "shoulder_deg",
        "elbow_deg",
        "gripper_deg",
        "coupling_deg",
    }
    protocol = hello["protocol"]
    assert [c["char"] for c in protocol["commands"]] == list("ABCDEFGHIJKL")
    assert protocol["stop"] == ["S", "0"]
    assert protocol["repeat_ms"] == 100
    assert protocol["timeout_ms"] == 400
    assert hello["world"]["trash"] == Simulation().snapshot()["trash"]
    json.dumps(hello)  # must be JSON serialisable


def test_state_contract():
    state = Simulation().snapshot()
    assert set(state) == STATE_KEYS
    assert set(state["robot"]) == {"x", "z", "yaw", "v", "omega"}
    assert set(state["drive"]) == {
        "command",
        "left_pwm",
        "right_pwm",
        "left_target",
        "right_target",
        "pins",
    }
    assert set(state["drive"]["pins"]) == {"ENA", "IN1", "IN2", "ENB", "IN3", "IN4"}
    assert set(state["arm"]) == {
        "base_deg",
        "shoulder_deg",
        "elbow_deg",
        "gripper_deg",
        "opening_m",
        "steps",
        "jog",
        "grasp_point",
        "held",
    }
    assert set(state["arm"]["steps"]) == {"base", "shoulder", "elbow"}
    assert set(state["arm"]["jog"]) == {"base", "shoulder", "elbow", "gripper"}
    assert len(state["arm"]["grasp_point"]) == 3
    assert state["arm"]["held"] is None
    assert set(state["mission"]) == {
        "total",
        "collected",
        "deposited",
        "elapsed_s",
        "distance_m",
        "complete",
    }
    assert set(state["battery"]) == {"voltage", "percent"}
    for item in state["trash"]:
        assert set(item) == {"id", "kind", "x", "y", "z", "yaw", "state"}
        assert item["state"] == "ground"
    json.dumps(state)


def test_state_floats_are_rounded_to_four_decimals():
    sim = connected_sim()
    hold(sim, "A", 0.77, release=False)

    def walk(value):
        if isinstance(value, float):
            assert value == round(value, 4)
        elif isinstance(value, dict):
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(sim.snapshot())


def test_bluetooth_connect_and_disconnect_lines():
    sim = Simulation()
    assert not sim.snapshot()["connected"]
    sim.handle_client_message({"type": "bt_connect"})
    assert sim.snapshot()["connected"]
    assert serial_lines(sim) == ["Carrito BT listo. Comandos: A B C D S", "[BT] Conectado"]
    sim.handle_client_message({"type": "bt_connect"})  # idempotent
    assert serial_lines(sim) == []
    sim.handle_client_message({"type": "bt_disconnect"})
    assert not sim.snapshot()["connected"]
    assert serial_lines(sim) == ["[BT] Desconectado"]


def test_tx_is_ignored_while_disconnected():
    sim = Simulation()
    sim.handle_client_message({"type": "tx", "data": "A"})
    sim.run_for(1.0)
    assert sim.drive.pose.x == config.SPAWN[0]
    assert sim.firmware.left_target == 0
    assert serial_lines(sim) == []
    assert not sim.mission.started


def test_disconnect_does_not_stop_the_car_but_the_timeout_does():
    sim = connected_sim()
    sim.transmit("A")
    sim.run_for(0.2)
    sim.disconnect()
    sim.run_for(0.1)
    assert sim.firmware.left_target == config.DRIVE_PWM  # USAR_PIN_STATE 0: still driving
    assert sim.drive.v > 0
    sim.run_for(0.3)
    assert sim.firmware.left_target == 0
    lines = serial_lines(sim)
    assert "[BT] Desconectado" in lines
    assert TIMEOUT_LINE in lines
    assert lines.index("[BT] Desconectado") < lines.index(TIMEOUT_LINE)


def test_held_button_repeats_keep_moving_and_release_stops():
    sim = connected_sim()
    hold(sim, "A", 2.0, release=False)
    assert sim.drive.v > 0.4
    assert TIMEOUT_LINE not in serial_lines(sim)
    sim.transmit("S")
    sim.run_for(0.4)
    assert sim.drive.v == 0.0
    assert sim.firmware.command == "S"


def test_lost_stop_is_covered_by_the_timeout():
    sim = connected_sim()
    sim.transmit("A")  # the app crashed right after the press
    sim.run_for(1.0)
    assert sim.drive.v == 0.0
    assert TIMEOUT_LINE in serial_lines(sim)


def test_command_lines_only_on_change():
    sim = connected_sim()
    hold(sim, "A", 1.0)
    hold(sim, "A", 0.3)
    lines = [line for line in serial_lines(sim) if line.startswith("[CMD]")]
    assert lines == ["[CMD] A", "[CMD] S", "[CMD] A", "[CMD] S"]


def test_mission_clock_starts_with_the_first_command_and_distance_accumulates():
    sim = connected_sim()
    sim.run_for(1.0)
    assert sim.snapshot()["mission"]["elapsed_s"] == 0.0
    hold(sim, "A", 1.0, release=False)
    mission = sim.snapshot()["mission"]
    assert mission["elapsed_s"] == pytest.approx(1.0, abs=0.05)
    assert mission["distance_m"] == pytest.approx(0.4, abs=0.1)
    assert mission["total"] == 8
    assert mission["collected"] == mission["deposited"] == 0
    assert mission["complete"] is False


def test_invalid_messages_are_ignored():
    sim = connected_sim()
    for message in (
        {},
        {"type": "nope"},
        {"type": "tx"},
        {"type": "tx", "data": 5},
        {"type": "tx", "data": None},
        {"type": ["bt_connect"]},
    ):
        sim.handle_client_message(message)
    sim.run_for(0.5)
    assert sim.firmware.left_target == 0


def test_garbage_characters_do_not_change_state():
    sim = connected_sim()
    sim.transmit("A")
    sim.run_for(0.1)
    sim.transmit("\r\n x?!")
    sim.run_for(0.1)
    assert sim.firmware.command == "A"
    assert sim.drive.v > 0


def test_reset_restores_world_and_mission_but_keeps_the_connection():
    sim = connected_sim()
    sim.arm.set_pose(base=40.0)
    hold(sim, "A", 1.0)
    sim.trash[0].x += 1.0
    sim.mission.record_grasp("t1")
    sim.handle_client_message({"type": "reset"})

    assert sim.bt_connected
    assert sim.time == 0.0
    assert (sim.drive.pose.x, sim.drive.pose.z) == (config.SPAWN[0], config.SPAWN[1])
    assert sim.arm.base.angle_deg == 0.0
    assert sim.mission.collected == 0
    assert not sim.mission.started
    assert sim.trash[0].x == sim.layout.trash[0].x
    assert serial_lines(sim) == ["Carrito BT listo. Comandos: A B C D S", "[BT] Conectado"]
    sim.transmit("A")  # still connected: commands work
    sim.run_for(0.5)
    assert sim.drive.v > 0


def test_reset_while_disconnected_stays_disconnected():
    sim = Simulation()
    sim.handle_client_message({"type": "reset"})
    assert not sim.bt_connected
    assert serial_lines(sim) == []


def test_outbox_is_chronological_and_drained():
    sim = connected_sim()
    hold(sim, "G", 6.0)
    messages = sim.drain_outbox()
    times = [m["t"] for m in messages]
    assert times == sorted(times)
    assert sim.drain_outbox() == []
    assert events(messages, "limit")


def test_each_simulation_is_independent():
    first, second = connected_sim(), connected_sim()
    hold(first, "A", 1.0)
    assert second.drive.pose.x == config.SPAWN[0]
    assert first.drive.pose.x > config.SPAWN[0]
