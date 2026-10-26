"""Wall-clock pacing of one :class:`~ecokar_sim.simulation.Simulation` (synchronous, no I/O).

This is the real-time behaviour that every transport shares: the FastAPI WebSocket session
(``server/session.py``) and the in-browser Pyodide bridge (``browser/bridge.py``) both feed it a
clock and forward whatever it returns. Keeping it here means there is one implementation of

* the fixed 10 ms physics step fed by an accumulator (a coarse timer only means several steps
  per tick), with a cap on catch-up steps and the backlog dropped when still late,
* the ``state`` cadence (~30 Hz) and the flush of serial lines and events on every tick,
* the handling of one raw client text frame (invalid input is ignored, never fatal).

Nothing here imports a web framework or ``asyncio``.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from . import config
from .simulation import Simulation

log = logging.getLogger("ecokar_sim.realtime")

STATE_PERIOD_S = 1.0 / config.STATE_RATE_HZ


class RealtimeLoop:
    """Turns "time has passed" into the outbound messages of one simulation."""

    def __init__(self, simulation: Simulation, now: float) -> None:
        self.simulation = simulation
        self._last = now
        self._accumulator = 0.0
        self._next_state = now

    def receive(self, text: str) -> None:
        """Apply one raw client frame. Anything that is not a valid message is ignored."""
        try:
            message = json.loads(text)
        except (TypeError, ValueError, RecursionError):
            return
        if not isinstance(message, dict):
            return
        try:
            self.simulation.handle_client_message(message)
        except Exception:  # a bad message must never take the loop down
            log.exception("error handling client message")

    def tick(self, now: float) -> list[dict[str, Any]]:
        """Advance to wall time ``now`` (seconds, monotonic).

        Returns the messages to send, in order: the serial lines and events produced since the
        previous tick, followed by a ``state`` snapshot when one is due.
        """
        sim = self.simulation
        dt = config.SIM_DT_S
        self._accumulator += now - self._last
        self._last = now

        steps = 0
        while self._accumulator >= dt and steps < config.MAX_CATCHUP_STEPS:
            sim.step(dt)
            self._accumulator -= dt
            steps += 1
        if self._accumulator >= dt:  # still late after catching up: drop the backlog
            self._accumulator = 0.0

        messages = sim.drain_outbox()
        if now >= self._next_state:
            messages.append(sim.snapshot())
            self._next_state = max(self._next_state + STATE_PERIOD_S, now - STATE_PERIOD_S)
        return messages
