"""Gripper <-> trash interaction: capture, carry and release.

Capture: while the gripper closes (L), an item lying on the ground (or falling) whose
centre is within ``GRASP_RADIUS_M`` of the grasp point and that fits between the open
fingers stops the servo at the angle where the opening equals the item width; the item
is then held. Release: opening the gripper beyond ``width + RELEASE_MARGIN_M`` lets go.
"""

from __future__ import annotations

import math
from collections.abc import Iterable
from dataclasses import dataclass

from .. import config
from ..world.trash import TrashItem, TrashState
from .arm import RoboticArm
from .servo import angle_for_opening

_FIT_EPSILON = 1e-9
_GRASPABLE = (TrashState.GROUND, TrashState.FALLING)


@dataclass(frozen=True)
class GraspEvent:
    name: str  # "grasp" | "release"
    item: TrashItem


def _distance(item: TrashItem, point: tuple[float, float, float]) -> float:
    return math.dist((item.x, item.y, item.z), point)


class GraspController:
    """Tracks the item in the gripper (at most one)."""

    def __init__(self) -> None:
        self.held: TrashItem | None = None
        self._candidate: TrashItem | None = None

    def gripper_floor_deg(
        self,
        arm: RoboticArm,
        grasp_point: tuple[float, float, float],
        items: Iterable[TrashItem],
        closing: bool,
    ) -> float | None:
        """Lowest angle the servo may reach this tick (an item between the fingers stalls it)."""
        self._candidate = None
        if self.held is not None:
            return angle_for_opening(self.held.width)
        if closing:
            candidate = self._nearest(grasp_point, items, arm.opening_m + _FIT_EPSILON)
            if candidate is not None:
                self._candidate = candidate
                return angle_for_opening(candidate.width)
        return None

    def update(
        self,
        arm: RoboticArm,
        grasp_point: tuple[float, float, float],
        heading: float,
        closing: bool,
    ) -> list[GraspEvent]:
        """Run after the arm step: carry, release or capture."""
        held = self.held
        if held is not None:
            if arm.opening_m > held.width + config.RELEASE_MARGIN_M:
                self.held = None
                held.start_falling()
                return [GraspEvent("release", held)]
            self._follow(held, grasp_point, heading)
            return []

        candidate = self._candidate
        if (
            closing
            and candidate is not None
            and candidate.state in _GRASPABLE
            and _distance(candidate, grasp_point) <= config.GRASP_RADIUS_M
            and arm.opening_m <= candidate.width + _FIT_EPSILON
        ):
            candidate.state = TrashState.HELD
            candidate.vy = 0.0
            self.held = candidate
            self._follow(candidate, grasp_point, heading)
            return [GraspEvent("grasp", candidate)]
        return []

    @staticmethod
    def _follow(item: TrashItem, point: tuple[float, float, float], heading: float) -> None:
        item.x, item.z = point[0], point[2]
        item.y = max(point[1], item.rest_height)
        item.yaw = heading

    @staticmethod
    def _nearest(
        point: tuple[float, float, float], items: Iterable[TrashItem], max_width: float
    ) -> TrashItem | None:
        fitting = [
            item
            for item in items
            if item.state in _GRASPABLE
            and item.width <= max_width
            and _distance(item, point) <= config.GRASP_RADIUS_M
        ]
        return min(fitting, key=lambda item: _distance(item, point), default=None)
