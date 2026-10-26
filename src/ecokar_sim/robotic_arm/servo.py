"""SG90 servo used as the gripper actuator."""

from __future__ import annotations

from dataclasses import dataclass

from .. import config

_ANGLE_SPAN_DEG = config.GRIPPER_OPEN_DEG - config.GRIPPER_CLOSED_DEG


def opening_for_angle(angle_deg: float) -> float:
    """Distance between the fingers (m) for a servo angle."""
    return config.GRIPPER_MAX_OPENING_M * (angle_deg - config.GRIPPER_CLOSED_DEG) / _ANGLE_SPAN_DEG


def angle_for_opening(opening_m: float) -> float:
    """Servo angle (deg) that gives a finger distance of ``opening_m``."""
    return config.GRIPPER_CLOSED_DEG + opening_m / config.GRIPPER_MAX_OPENING_M * _ANGLE_SPAN_DEG


@dataclass
class Servo:
    """Gripper: 10 deg = closed, 80 deg = open.

    The jog rate while a button is held is ``GRIPPER_JOG_DEG_S``; the physical SG90 is
    faster (``GRIPPER_MAX_DEG_S``), so the jog rate is the limiting one.
    """

    angle_deg: float = config.GRIPPER_OPEN_DEG
    min_deg: float = config.GRIPPER_CLOSED_DEG
    max_deg: float = config.GRIPPER_OPEN_DEG
    jog_deg_s: float = config.GRIPPER_JOG_DEG_S

    @property
    def speed_deg_s(self) -> float:
        return min(self.jog_deg_s, config.GRIPPER_MAX_DEG_S)

    @property
    def opening_m(self) -> float:
        return opening_for_angle(self.angle_deg)

    def step(self, direction: int, dt: float, floor_deg: float | None = None) -> tuple[bool, bool]:
        """Jog ``direction`` (+1 open, -1 close) for ``dt``.

        ``floor_deg`` is a stall angle (the fingers rest on an item). Returns
        ``(moved, hit_limit)``; ``hit_limit`` is True only for the mechanical end stops,
        not for a stall on an item.
        """
        if direction == 0:
            return False, False
        lower = self.min_deg if floor_deg is None else max(self.min_deg, floor_deg)
        target = self.angle_deg + direction * self.speed_deg_s * dt
        new_angle = max(lower, min(self.max_deg, target))
        moved = new_angle != self.angle_deg
        self.angle_deg = new_angle
        at_end_stop = new_angle in (self.min_deg, self.max_deg) and new_angle != target
        stalled = floor_deg is not None and new_angle == lower and lower > self.min_deg
        return moved, at_end_stop and not stalled
