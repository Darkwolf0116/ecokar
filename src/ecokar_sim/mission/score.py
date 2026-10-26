"""Mission bookkeeping: trash collected, deposited, time and distance."""

from __future__ import annotations


class Mission:
    """Counts progress. ``collected`` = unique items ever grasped, ``deposited`` = in the crate."""

    def __init__(self, total: int) -> None:
        self.total = total
        self.elapsed_s = 0.0
        self.distance_m = 0.0
        self.started = False
        self._collected: set[str] = set()
        self._deposited: set[str] = set()

    @property
    def collected(self) -> int:
        return len(self._collected)

    @property
    def deposited(self) -> int:
        return len(self._deposited)

    @property
    def complete(self) -> bool:
        return self.total > 0 and self.deposited >= self.total

    def start(self) -> None:
        """The clock starts with the first valid command after the Bluetooth connection."""
        self.started = True

    def tick(self, dt: float) -> None:
        if self.started and not self.complete:
            self.elapsed_s += dt

    def add_distance(self, metres: float) -> None:
        if not self.complete:
            self.distance_m += metres

    def record_grasp(self, item_id: str) -> None:
        self._collected.add(item_id)

    def record_deposit(self, item_id: str) -> bool:
        """Register a deposit. Returns True exactly when this deposit completes the mission."""
        was_complete = self.complete
        self._collected.add(item_id)
        self._deposited.add(item_id)
        return self.complete and not was_complete
