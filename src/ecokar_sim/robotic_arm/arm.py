"""The robotic arm: three steppers, one servo, limits, coupling and ground clamp."""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import dataclass

from .. import config
from . import kinematics
from .servo import Servo
from .stepper import Stepper

STEPPER_JOINTS: tuple[str, ...] = ("base", "shoulder", "elbow")
JOINTS: tuple[str, ...] = (*STEPPER_JOINTS, "gripper")

REASON_RANGE = "range"
REASON_COUPLING = "coupling"
REASON_GROUND = "ground"


@dataclass(frozen=True)
class LimitHit:
    """A jogged joint just got blocked (reported once per hit)."""

    joint: str
    reason: str  # "range" | "coupling" | "ground"

    @property
    def label(self) -> str:
        """Name printed after "[BRAZO] Límite": the joint, or "ground"."""
        return "ground" if self.reason == REASON_GROUND else self.joint


class RoboticArm:
    """EEZYbotARM MK3 with a gripper. Home: base 0, shoulder 90, elbow 0, gripper open."""

    def __init__(self) -> None:
        self.base = Stepper(config.BASE_JOINT)
        self.shoulder = Stepper(config.SHOULDER_JOINT)
        self.elbow = Stepper(config.ELBOW_JOINT)
        self.gripper = Servo()
        self._blocked: dict[str, str | None] = dict.fromkeys(JOINTS)
        self.moving: dict[str, bool] = dict.fromkeys(JOINTS, False)

    # ------------------------------------------------------------------- state
    @property
    def steppers(self) -> dict[str, Stepper]:
        return {"base": self.base, "shoulder": self.shoulder, "elbow": self.elbow}

    @property
    def steps(self) -> dict[str, int]:
        return {name: stepper.steps for name, stepper in self.steppers.items()}

    @property
    def opening_m(self) -> float:
        return self.gripper.opening_m

    def heading(self, robot_yaw: float) -> float:
        """World heading (rad) the arm points at."""
        return robot_yaw + math.radians(self.base.angle_deg)

    def grasp_radial(self) -> float:
        """Horizontal distance from the base axis to the grasp point."""
        pose = kinematics.planar_forward(self.shoulder.angle_deg, self.elbow.angle_deg)
        return pose.grasp[0]

    def grasp_point_world(self, x: float, z: float, yaw: float) -> tuple[float, float, float]:
        """World (x, y, z) of the point between the fingers for a robot pose."""
        gx, gz = kinematics.radial_point_world(self.grasp_radial(), self.base.angle_deg, x, z, yaw)
        gy = kinematics.grasp_height(self.shoulder.angle_deg, self.elbow.angle_deg)
        return gx, gy, gz

    # -------------------------------------------------------------------- pose
    def pose_problem(self, shoulder_deg: float, elbow_deg: float) -> str | None:
        """Why a (shoulder, elbow) pair is not allowed, or None if it is reachable."""
        if not kinematics.coupling_ok(shoulder_deg, elbow_deg):
            return REASON_COUPLING
        grasp_y = kinematics.grasp_height(shoulder_deg, elbow_deg)
        fingertip_y = grasp_y - config.FINGERTIP_DROP_M
        if grasp_y < config.GROUND_MIN_GRASP_Y_M or fingertip_y < config.GROUND_MIN_FINGERTIP_Y_M:
            return REASON_GROUND
        return None

    def set_pose(
        self,
        base: float | None = None,
        shoulder: float | None = None,
        elbow: float | None = None,
        gripper: float | None = None,
    ) -> None:
        """Teleport joints (clamped to their limits). Raises if the pose is not reachable."""
        new_shoulder = self.shoulder.angle_deg if shoulder is None else shoulder
        new_elbow = self.elbow.angle_deg if elbow is None else elbow
        new_shoulder = self.shoulder.clamp(new_shoulder)
        new_elbow = self.elbow.clamp(new_elbow)
        problem = self.pose_problem(new_shoulder, new_elbow)
        if problem is not None:
            raise ValueError(f"unreachable arm pose ({problem}): {new_shoulder}, {new_elbow}")
        self.shoulder.angle_deg = new_shoulder
        self.elbow.angle_deg = new_elbow
        if base is not None:
            self.base.angle_deg = self.base.clamp(base)
        if gripper is not None:
            self.gripper.angle_deg = max(self.gripper.min_deg, min(self.gripper.max_deg, gripper))

    # -------------------------------------------------------------------- step
    def step(
        self,
        dt: float,
        jog: Mapping[str, int],
        gripper_floor_deg: float | None = None,
    ) -> list[LimitHit]:
        """Jog every joint whose direction is non-zero; return the new limit hits."""
        hits: list[LimitHit] = []
        for name in STEPPER_JOINTS:
            reason = self._jog_stepper(name, jog.get(name, 0), dt)
            self._track_block(name, reason, hits)
        reason = self._jog_gripper(jog.get("gripper", 0), dt, gripper_floor_deg)
        self._track_block("gripper", reason, hits)
        return hits

    def _track_block(self, name: str, reason: str | None, hits: list[LimitHit]) -> None:
        if reason is not None and self._blocked[name] != reason:
            hits.append(LimitHit(name, reason))
        self._blocked[name] = reason

    def _jog_stepper(self, name: str, direction: int, dt: float) -> str | None:
        stepper = self.steppers[name]
        if direction == 0:
            self.moving[name] = False
            return None

        target, clamped = stepper.candidate(direction, dt)
        problem = self._candidate_problem(name, target)
        if problem is not None:
            self.moving[name] = False
            return problem

        self.moving[name] = target != stepper.angle_deg
        stepper.angle_deg = target
        return REASON_RANGE if clamped else None

    def _candidate_problem(self, name: str, angle: float) -> str | None:
        """Coupling / ground check for a new angle of ``name`` (base has neither)."""
        if name == "base":
            return None
        shoulder = angle if name == "shoulder" else self.shoulder.angle_deg
        elbow = angle if name == "elbow" else self.elbow.angle_deg
        return self.pose_problem(shoulder, elbow)

    def _jog_gripper(self, direction: int, dt: float, floor_deg: float | None) -> str | None:
        moved, hit_limit = self.gripper.step(direction, dt, floor_deg)
        self.moving["gripper"] = moved
        return REASON_RANGE if hit_limit else None
