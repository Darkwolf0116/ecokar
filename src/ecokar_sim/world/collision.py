"""Geometry helpers: circles against oriented rectangles and axis-aligned bounds.

Rectangles use the same convention as the rest of the project: ``yaw`` rotates the
local +X axis towards world -Z (Three.js ``rotation.y``), ``w`` is the size along
local X and ``d`` the size along local Z.
"""

from __future__ import annotations

import math
from dataclasses import dataclass


@dataclass(frozen=True)
class OrientedRect:
    x: float
    z: float
    yaw: float
    w: float  # full size along local X
    d: float  # full size along local Z

    def to_local(self, wx: float, wz: float) -> tuple[float, float]:
        dx, dz = wx - self.x, wz - self.z
        c, s = math.cos(self.yaw), math.sin(self.yaw)
        return dx * c - dz * s, dx * s + dz * c

    def vector_to_world(self, lx: float, lz: float) -> tuple[float, float]:
        c, s = math.cos(self.yaw), math.sin(self.yaw)
        return lx * c + lz * s, -lx * s + lz * c

    def contains(self, wx: float, wz: float, margin: float = 0.0) -> bool:
        """True if the point is inside the rectangle shrunk by ``margin``."""
        lx, lz = self.to_local(wx, wz)
        return abs(lx) <= self.w / 2 - margin and abs(lz) <= self.d / 2 - margin


def circle_overlaps_rect(cx: float, cz: float, radius: float, rect: OrientedRect) -> bool:
    lx, lz = rect.to_local(cx, cz)
    qx = max(-rect.w / 2, min(rect.w / 2, lx))
    qz = max(-rect.d / 2, min(rect.d / 2, lz))
    return (lx - qx) ** 2 + (lz - qz) ** 2 < radius * radius


def push_circle_out(cx: float, cz: float, radius: float, rect: OrientedRect) -> tuple[float, float]:
    """Move a circle along the minimum translation so it no longer overlaps ``rect``."""
    half_w, half_d = rect.w / 2, rect.d / 2
    lx, lz = rect.to_local(cx, cz)
    qx = max(-half_w, min(half_w, lx))
    qz = max(-half_d, min(half_d, lz))
    dx, dz = lx - qx, lz - qz
    dist = math.hypot(dx, dz)
    if dist >= radius:
        return cx, cz

    if dist > 1e-12:
        nx, nz = dx / dist, dz / dist
        move = radius - dist
    else:
        # Centre inside the rectangle: leave through the nearest face.
        gaps = (
            (half_w - lx, 1.0, 0.0),
            (lx + half_w, -1.0, 0.0),
            (half_d - lz, 0.0, 1.0),
            (lz + half_d, 0.0, -1.0),
        )
        gap, nx, nz = min(gaps, key=lambda g: g[0])
        move = gap + radius

    wx, wz = rect.vector_to_world(nx * move, nz * move)
    return cx + wx, cz + wz


@dataclass(frozen=True)
class Bounds:
    """Axis-aligned drivable region."""

    x_min: float
    x_max: float
    z_min: float
    z_max: float

    def contains_circle(self, x: float, z: float, radius: float) -> bool:
        return (
            self.x_min + radius <= x <= self.x_max - radius
            and self.z_min + radius <= z <= self.z_max - radius
        )

    def clamp_circle(self, x: float, z: float, radius: float) -> tuple[float, float]:
        return (
            max(self.x_min + radius, min(self.x_max - radius, x)),
            max(self.z_min + radius, min(self.z_max - radius, z)),
        )
