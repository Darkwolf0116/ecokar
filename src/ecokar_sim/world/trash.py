"""Loose trash: kinds, lifecycle states and gravity."""

from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from .. import config


class TrashState(StrEnum):
    GROUND = "ground"
    HELD = "held"
    FALLING = "falling"
    DEPOSITED = "deposited"


@dataclass(frozen=True)
class TrashKindSpec:
    kind: str
    width: float  # across the gripper (the dimension the fingers pinch), metres
    length: float
    rest_height: float  # centre height when lying on a flat surface


KIND_SPECS: dict[str, TrashKindSpec] = {
    "bottle": TrashKindSpec("bottle", width=0.040, length=0.11, rest_height=0.020),
    "can": TrashKindSpec("can", width=0.034, length=0.07, rest_height=0.017),
    "paper": TrashKindSpec("paper", width=0.036, length=0.036, rest_height=0.018),
}


@dataclass
class TrashItem:
    id: str
    kind: str
    x: float
    z: float
    yaw: float
    y: float = 0.0
    state: TrashState = TrashState.GROUND
    vy: float = 0.0  # vertical speed while falling (m/s)

    def __post_init__(self) -> None:
        if self.y == 0.0:
            self.y = self.rest_height

    @property
    def spec(self) -> TrashKindSpec:
        return KIND_SPECS[self.kind]

    @property
    def width(self) -> float:
        return self.spec.width

    @property
    def length(self) -> float:
        return self.spec.length

    @property
    def rest_height(self) -> float:
        return self.spec.rest_height

    @property
    def radius(self) -> float:
        """Footprint radius used to keep the item out of the chassis and obstacles."""
        return self.spec.length / 2

    def start_falling(self) -> None:
        self.state = TrashState.FALLING
        self.vy = 0.0

    def fall(self, dt: float, floor_y: float) -> bool:
        """Integrate gravity; return True when the item reaches ``floor_y`` (it lands)."""
        self.vy -= config.GRAVITY_MPS2 * dt
        self.y += self.vy * dt
        if self.y <= floor_y:
            self.y = floor_y
            self.vy = 0.0
            return True
        return False

    def as_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "kind": self.kind,
            "x": self.x,
            "y": self.y,
            "z": self.z,
            "yaw": self.yaw,
            "state": self.state.value,
        }
