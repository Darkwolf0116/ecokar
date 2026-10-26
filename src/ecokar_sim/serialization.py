"""JSON-ready dictionaries for the WebSocket contract (``hello`` and ``state``).

Pure functions over a :class:`~ecokar_sim.simulation.Simulation`; no framework imports.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from . import config
from .bluetooth.protocol import STOP_CHARS, button_table

if TYPE_CHECKING:
    from .simulation import Simulation

FLOAT_DIGITS = 4


def encode(message: dict[str, Any]) -> str:
    """The exact JSON text of one outbound frame (shared by every transport)."""
    return json.dumps(message, separators=(",", ":"), ensure_ascii=False)


def round_floats(value: Any) -> Any:
    """Recursively round floats so frames stay small."""
    if isinstance(value, float):
        return round(value, FLOAT_DIGITS)
    if isinstance(value, dict):
        return {key: round_floats(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [round_floats(item) for item in value]
    return value


def robot_spec() -> dict[str, Any]:
    """Chassis and arm dimensions for rendering the 3D model."""
    joints = (config.BASE_JOINT, config.SHOULDER_JOINT, config.ELBOW_JOINT)
    limits = {f"{j.name}_deg": [j.min_deg, j.max_deg] for j in joints}
    limits["gripper_deg"] = [config.GRIPPER_CLOSED_DEG, config.GRIPPER_OPEN_DEG]
    limits["coupling_deg"] = [config.COUPLING_MIN_DEG, config.COUPLING_MAX_DEG]
    home = {f"{j.name}_deg": j.home_deg for j in joints}
    home["gripper_deg"] = config.GRIPPER_OPEN_DEG
    return {
        "plate_length": config.PLATE_LENGTH_M,
        "plate_width": config.PLATE_WIDTH_M,
        "plate_y": config.PLATE_Y_M,
        "wheel_radius": config.WHEEL_RADIUS_M,
        "wheel_width": config.WHEEL_WIDTH_M,
        "track": config.TRACK_M,
        "wheelbase": config.WHEELBASE_M,
        "collision_radius": config.COLLISION_RADIUS_M,
        "v_max": config.V_MAX_MPS,
        "arm_mount": list(config.ARM_MOUNT_M),
        "shoulder_height": config.SHOULDER_HEIGHT_M,
        "l1": config.L1_M,
        "l2": config.L2_M,
        "grasp_offset": list(config.GRASP_OFFSET_M),
        "gripper_max_opening": config.GRIPPER_MAX_OPENING_M,
        "home": home,
        "limits": limits,
    }


def world_spec(sim: Simulation) -> dict[str, Any]:
    layout = sim.layout
    road = layout.road
    return {
        "road": {
            "x_min": road.x_min,
            "x_max": road.x_max,
            "z_min": road.z_min,
            "z_max": road.z_max,
        },
        "sidewalk_width": layout.sidewalk_width,
        "curb_height": layout.curb_height,
        "obstacles": [o.as_dict() for o in layout.obstacles],
        "crate": layout.crate.as_dict(),
        "decor": [d.as_dict() for d in layout.decor],
        "trash": [item.as_dict() for item in sim.trash],
    }


def hello_message(sim: Simulation) -> dict[str, Any]:
    return round_floats(
        {
            "type": "hello",
            "version": config.PROTOCOL_VERSION,
            "world": world_spec(sim),
            "robot": robot_spec(),
            "protocol": {
                "commands": button_table(),
                "stop": list(STOP_CHARS),
                "repeat_ms": config.APP_REPEAT_MS,
                "timeout_ms": config.COMMAND_TIMEOUT_MS,
            },
        }
    )


def state_message(sim: Simulation) -> dict[str, Any]:
    fw = sim.firmware
    arm = sim.arm
    pose = sim.drive.pose
    gx, gy, gz = sim.grasp_point()
    held = sim.grasp.held
    return round_floats(
        {
            "type": "state",
            "t": sim.time,
            "connected": sim.bt_connected,
            "robot": {
                "x": pose.x,
                "z": pose.z,
                "yaw": pose.yaw,
                "v": sim.drive.v,
                "omega": sim.drive.omega,
            },
            "drive": {
                "command": fw.command,
                "left_pwm": fw.left_pwm,
                "right_pwm": fw.right_pwm,
                "left_target": fw.left_target,
                "right_target": fw.right_target,
                "pins": fw.pins.as_dict(),
            },
            "arm": {
                "base_deg": arm.base.angle_deg,
                "shoulder_deg": arm.shoulder.angle_deg,
                "elbow_deg": arm.elbow.angle_deg,
                "gripper_deg": arm.gripper.angle_deg,
                "opening_m": arm.opening_m,
                "steps": arm.steps,
                "jog": dict(fw.jog),
                "grasp_point": [gx, gy, gz],
                "held": held.id if held is not None else None,
            },
            "trash": [item.as_dict() for item in sim.trash],
            "mission": {
                "total": sim.mission.total,
                "collected": sim.mission.collected,
                "deposited": sim.mission.deposited,
                "elapsed_s": sim.mission.elapsed_s,
                "distance_m": sim.mission.distance_m,
                "complete": sim.mission.complete,
            },
            "battery": {
                "voltage": sim.battery.voltage,
                "percent": sim.battery.percent,
            },
        }
    )
