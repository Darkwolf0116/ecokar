"""Street layout: bounds, obstacles, the collection crate and the initial trash.

Real scale: the robot (0.26 m) is tiny on a 12 x 6 m street, which is intended.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, replace

from .. import config
from .collision import Bounds, OrientedRect, circle_overlaps_rect, push_circle_out
from .trash import KIND_SPECS


@dataclass(frozen=True)
class Obstacle:
    """A solid box on the road (rotated rectangle with a render height)."""

    id: str
    kind: str
    x: float
    z: float
    yaw: float
    w: float
    d: float
    h: float

    @property
    def rect(self) -> OrientedRect:
        return OrientedRect(self.x, self.z, self.yaw, self.w, self.d)

    def as_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "kind": self.kind,
            "x": self.x,
            "z": self.z,
            "yaw": self.yaw,
            "w": self.w,
            "d": self.d,
            "h": self.h,
        }


@dataclass(frozen=True)
class Crate:
    """Open-top collection crate. ``w`` x ``d`` is the OUTER footprint."""

    x: float
    z: float
    yaw: float
    w: float
    d: float
    h: float
    wall: float

    @property
    def rect(self) -> OrientedRect:
        return OrientedRect(self.x, self.z, self.yaw, self.w, self.d)

    @property
    def inner(self) -> OrientedRect:
        return OrientedRect(
            self.x, self.z, self.yaw, self.w - 2 * self.wall, self.d - 2 * self.wall
        )

    @property
    def floor_y(self) -> float:
        return config.CRATE_FLOOR_THICKNESS_M

    def contains_xz(self, x: float, z: float) -> bool:
        """True if a point is inside the inner footprint (where trash counts as deposited)."""
        return self.inner.contains(x, z)

    def as_dict(self) -> dict[str, object]:
        return {
            "x": self.x,
            "z": self.z,
            "yaw": self.yaw,
            "w": self.w,
            "d": self.d,
            "h": self.h,
            "wall": self.wall,
        }


@dataclass(frozen=True)
class TrashSpec:
    id: str
    kind: str
    x: float
    z: float
    yaw: float


@dataclass(frozen=True)
class Decor:
    """Purely visual element (not an obstacle)."""

    id: str
    kind: str
    x: float
    z: float
    radius: float

    def as_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "kind": self.kind,
            "x": self.x,
            "z": self.z,
            "radius": self.radius,
        }


@dataclass(frozen=True)
class Layout:
    road: Bounds
    sidewalk_width: float
    curb_height: float
    obstacles: tuple[Obstacle, ...]
    crate: Crate
    trash: tuple[TrashSpec, ...]
    decor: tuple[Decor, ...]
    spawn: tuple[float, float, float]  # x, z, yaw

    def solids(self) -> list[tuple[str, OrientedRect]]:
        """Everything the chassis cannot drive through (curbs are handled by ``road``)."""
        solids = [(o.id, o.rect) for o in self.obstacles]
        solids.append(("crate", self.crate.rect))
        return solids

    def blocking_reason(self, x: float, z: float, radius: float) -> str | None:
        """What a circle at (x, z) would hit: ``road`` (curb), an obstacle id or ``crate``."""
        if not self.road.contains_circle(x, z, radius):
            return "road"
        for name, rect in self.solids():
            if circle_overlaps_rect(x, z, radius, rect):
                return name
        return None

    def resolve_circle(self, x: float, z: float, radius: float) -> tuple[float, float]:
        """Push a circle out of obstacles / crate and back inside the road."""
        for _ in range(2):
            for _, rect in self.solids():
                x, z = push_circle_out(x, z, radius, rect)
            x, z = self.road.clamp_circle(x, z, radius)
        return x, z


def _base_layout() -> Layout:
    road = Bounds(*config.ROAD_X_M, *config.ROAD_Z_M)
    obstacles = (
        Obstacle("car-1", "car", 0.5, 2.0, 0.0, 4.2, 1.8, 1.45),
        Obstacle("cone-1", "cone", -3.0, 0.9, 0.0, 0.3, 0.3, 0.5),
        Obstacle("cone-2", "cone", -0.2, -0.9, 0.0, 0.3, 0.3, 0.5),
        Obstacle("cone-3", "cone", 3.6, 0.2, 0.0, 0.3, 0.3, 0.5),
    )
    crate = Crate(x=4.5, z=-2.2, yaw=0.0, w=0.32, d=0.32, h=0.10, wall=0.01)
    trash = (
        TrashSpec("t1", "bottle", -3.4, 1.9, 0.6),
        TrashSpec("t2", "can", -1.9, -1.4, 2.1),
        TrashSpec("t3", "paper", -0.2, 0.7, 0.0),
        TrashSpec("t4", "bottle", 1.6, -2.7, 1.2),
        TrashSpec("t5", "can", 3.1, 2.2, 0.3),
        TrashSpec("t6", "paper", 0.9, -0.3, 0.0),
        TrashSpec("t7", "bottle", -4.8, -2.4, 0.9),
        TrashSpec("t8", "can", 2.4, 0.4, 2.7),
    )
    decor = (Decor("manhole-1", "manhole", -1.5, -0.2, 0.3),)
    return Layout(
        road=road,
        sidewalk_width=config.SIDEWALK_WIDTH_M,
        curb_height=config.CURB_HEIGHT_M,
        obstacles=obstacles,
        crate=crate,
        trash=trash,
        decor=decor,
        spawn=config.SPAWN,
    )


def _valid_trash_spot(layout: Layout, x: float, z: float, radius: float) -> bool:
    if layout.blocking_reason(x, z, radius + 0.1) is not None:
        return False
    spawn_x, spawn_z, _ = layout.spawn
    return math.hypot(x - spawn_x, z - spawn_z) > 0.6


def build_layout(seed: int | None = None) -> Layout:
    """Return the street. ``seed=None`` gives the fixed layout; a seed jitters the trash."""
    layout = _base_layout()
    if seed is None:
        return layout

    rng = random.Random(seed)
    jittered: list[TrashSpec] = []
    for spec in layout.trash:
        radius = KIND_SPECS[spec.kind].length / 2
        chosen = spec
        for _ in range(30):
            x = spec.x + rng.uniform(-0.4, 0.4)
            z = spec.z + rng.uniform(-0.4, 0.4)
            if _valid_trash_spot(layout, x, z, radius):
                chosen = replace(spec, x=x, z=z, yaw=rng.uniform(0.0, math.tau))
                break
        jittered.append(chosen)
    return replace(layout, trash=tuple(jittered))
