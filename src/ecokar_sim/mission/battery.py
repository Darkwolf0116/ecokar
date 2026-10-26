"""2S LiPo battery model (2200 mAh)."""

from __future__ import annotations

from .. import config


def voltage_for_percent(percent: float) -> float:
    """Pack voltage for a state of charge, interpolating ``BATTERY_CURVE``."""
    curve = config.BATTERY_CURVE
    percent = max(curve[0][0], min(curve[-1][0], percent))
    for (p0, v0), (p1, v1) in zip(curve, curve[1:], strict=False):
        if percent <= p1:
            return v0 + (v1 - v0) * (percent - p0) / (p1 - p0)
    return curve[-1][1]


class Battery:
    """Integrates the current drawn by the drive, the steppers and the servo."""

    def __init__(self) -> None:
        self.capacity_ah = config.BATTERY_CAPACITY_AH
        self.used_ah = 0.0
        self.current_a = config.BATTERY_IDLE_A

    @property
    def percent(self) -> float:
        return max(0.0, 100.0 * (1.0 - self.used_ah / self.capacity_ah))

    @property
    def voltage(self) -> float:
        return voltage_for_percent(self.percent)

    def step(
        self, dt: float, left_pwm: int, right_pwm: int, steppers_moving: int, servo_moving: bool
    ) -> float:
        """Draw current for ``dt`` seconds and return the current (A)."""
        drive_load = (abs(left_pwm) + abs(right_pwm)) / (2 * config.PWM_MAX)
        current = (
            config.BATTERY_IDLE_A
            + config.BATTERY_DRIVE_A * drive_load
            + config.BATTERY_STEPPER_A * steppers_moving
            + (config.BATTERY_SERVO_A if servo_moving else 0.0)
        )
        self.current_a = current
        self.used_ah += current * dt / 3600.0
        return current
