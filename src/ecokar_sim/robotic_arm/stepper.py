"""28BYJ-48 stepper (driven by a ULN2003) used as a rate-limited joint actuator."""

from __future__ import annotations

from dataclasses import dataclass, field

from .. import config


@dataclass
class Stepper:
    """One joint: angle, limits, jog speed and the step counter the firmware would keep.

    ``angle_deg`` is the JOINT angle. The motor makes ``gear_ratio`` turns per joint turn
    (gear ratios are approximations of the printed gear train).
    """

    spec: config.JointSpec
    angle_deg: float = field(init=False)

    def __post_init__(self) -> None:
        self.angle_deg = self.spec.home_deg

    @property
    def name(self) -> str:
        return self.spec.name

    @property
    def speed_deg_s(self) -> float:
        """Jog speed, never above what the 28BYJ-48 can deliver at the joint."""
        max_joint_speed = config.STEPPER_MAX_OUTPUT_DEG_S / self.spec.gear_ratio
        return min(self.spec.jog_speed_deg_s, max_joint_speed)

    @property
    def steps(self) -> int:
        """Steps from home: round(angle_from_home * 2048 / 360 * gear_ratio)."""
        from_home = self.angle_deg - self.spec.home_deg
        return round(from_home * config.STEPS_PER_OUTPUT_REV / 360.0 * self.spec.gear_ratio)

    def candidate(self, direction: int, dt: float) -> tuple[float, bool]:
        """Angle after jogging ``direction`` (-1/+1) for ``dt``, clamped to the joint limits.

        Returns ``(angle, hit_limit)``; ``hit_limit`` is True when the clamp was needed.
        """
        target = self.angle_deg + direction * self.speed_deg_s * dt
        clamped = max(self.spec.min_deg, min(self.spec.max_deg, target))
        return clamped, clamped != target

    def clamp(self, angle_deg: float) -> float:
        return max(self.spec.min_deg, min(self.spec.max_deg, angle_deg))
