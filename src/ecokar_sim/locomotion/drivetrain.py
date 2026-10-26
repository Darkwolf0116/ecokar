"""Skid-steer kinematics of the 4WD chassis, driven by the left/right PWM values.

The two motors of a side are wired in parallel, so each side behaves as one wheel.
The speed of a side is proportional to its *logical* signed PWM (the value the
firmware ramps); the sketch's ``INVERTIR_*`` flags only compensate wiring polarity at
the pins, so they do not change the physical direction seen here.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass

from .. import config


@dataclass
class Pose:
    """Robot pose on the ground plane. Forward is ``(cos yaw, -sin yaw)`` in (x, z)."""

    x: float
    z: float
    yaw: float

    def forward(self) -> tuple[float, float]:
        return math.cos(self.yaw), -math.sin(self.yaw)


def side_speed(pwm: int) -> float:
    """Ground speed (m/s) of one side for a signed PWM value."""
    return pwm / config.PWM_MAX * config.V_MAX_MPS


def body_velocity(left_pwm: int, right_pwm: int) -> tuple[float, float]:
    """Return (v [m/s], omega [rad/s]); omega > 0 turns left (counter-clockwise)."""
    v_left = side_speed(left_pwm)
    v_right = side_speed(right_pwm)
    v = (v_left + v_right) / 2.0
    omega = (v_right - v_left) / (config.TRACK_M * config.SKID_FACTOR)
    return v, omega


class DriveTrain:
    """Integrates the chassis pose; a blocked translation is rejected (yaw still turns)."""

    def __init__(self, pose: Pose) -> None:
        self.pose = pose
        self.v = 0.0
        self.omega = 0.0

    def step(
        self,
        dt: float,
        left_pwm: int,
        right_pwm: int,
        blocking_reason: Callable[[float, float], str | None],
    ) -> str | None:
        """Advance one step. Returns the blocking reason if the translation was rejected.

        The collision shape is a circle, so rotating in place can never collide; only the
        translation is tested against ``blocking_reason(x, z)``.
        """
        v, omega = body_velocity(left_pwm, right_pwm)
        pose = self.pose
        mid_yaw = pose.yaw + omega * dt / 2.0
        new_x = pose.x + v * dt * math.cos(mid_yaw)
        new_z = pose.z - v * dt * math.sin(mid_yaw)

        reason: str | None = None
        if v != 0.0:
            reason = blocking_reason(new_x, new_z)
        if reason is None:
            pose.x, pose.z = new_x, new_z
            self.v = v
        else:
            self.v = 0.0
        pose.yaw += omega * dt
        self.omega = omega
        return reason
