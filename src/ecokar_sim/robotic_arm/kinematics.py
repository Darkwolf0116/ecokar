"""Forward kinematics of the EEZYbotARM MK3 (planar arm + base yaw).

Arm plane coordinates: ``r`` is the horizontal distance from the base axis along the
arm heading, ``h`` is the height above the shoulder pivot. The forearm angle is ABSOLUTE
(the parallelogram linkage keeps it independent of the main arm) and the gripper stays
level, so the grasp point is the wrist plus a fixed (forward, down) offset.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .. import config


@dataclass(frozen=True)
class PlanarPose:
    """Joint positions in the arm plane, relative to the shoulder pivot (r, h)."""

    elbow: tuple[float, float]
    wrist: tuple[float, float]
    grasp: tuple[float, float]


def planar_forward(shoulder_deg: float, elbow_deg: float) -> PlanarPose:
    t1 = math.radians(shoulder_deg)
    t2 = math.radians(elbow_deg)
    elbow = (config.L1_M * math.cos(t1), config.L1_M * math.sin(t1))
    wrist = (elbow[0] + config.L2_M * math.cos(t2), elbow[1] + config.L2_M * math.sin(t2))
    off_r, off_h = config.GRASP_OFFSET_M
    return PlanarPose(elbow, wrist, (wrist[0] + off_r, wrist[1] + off_h))


def shoulder_pivot_height() -> float:
    """Height of the shoulder pivot above the ground."""
    return config.PLATE_Y_M + config.SHOULDER_HEIGHT_M


def grasp_height(shoulder_deg: float, elbow_deg: float) -> float:
    """Height of the grasp point above the ground (independent of base angle and yaw)."""
    return shoulder_pivot_height() + planar_forward(shoulder_deg, elbow_deg).grasp[1]


def coupling_ok(shoulder_deg: float, elbow_deg: float) -> bool:
    """Mechanical coupling: the angle between both links must stay inside its band."""
    spread = shoulder_deg - elbow_deg
    return config.COUPLING_MIN_DEG <= spread <= config.COUPLING_MAX_DEG


def base_pivot_world(x: float, z: float, yaw: float) -> tuple[float, float]:
    """Ground position (x, z) of the base axis for a robot pose."""
    mount_x = config.ARM_MOUNT_M[0]
    return x + mount_x * math.cos(yaw), z - mount_x * math.sin(yaw)


def radial_point_world(
    r: float, base_deg: float, x: float, z: float, yaw: float
) -> tuple[float, float]:
    """World (x, z) of a point at radial distance ``r`` along the arm heading."""
    bx, bz = base_pivot_world(x, z, yaw)
    heading = yaw + math.radians(base_deg)
    return bx + r * math.cos(heading), bz - r * math.sin(heading)
