"""In-browser transport: one simulation driven from JavaScript, no sockets and no asyncio.

The static (Vercel) build cannot hold a WebSocket, so the same pure-Python core runs in a Web
Worker through Pyodide. The worker owns the clock (``setInterval`` plus ``performance.now()``)
and speaks the exact message protocol of ``docs/protocol.md`` as JSON *strings*:

* page -> worker: ``session.receive(text)`` with one client frame,
* worker -> page: ``session.hello()`` once, then every frame returned by
  ``session.advance(elapsed_s)``.

Pacing and message handling are the shared :class:`~ecokar_sim.realtime.RealtimeLoop`, so the
real-time behaviour matches ``server/session.py`` (fixed 10 ms step, same catch-up cap, ``state``
at ~30 Hz, serial lines and events flushed on every tick) and the JSON is byte-compatible.
"""

from __future__ import annotations

import math

from ..realtime import RealtimeLoop
from ..serialization import encode
from ..simulation import Simulation


class BrowserSession:
    """One robot for one browser tab. All methods are synchronous and never raise on bad input."""

    def __init__(self, simulation: Simulation | None = None) -> None:
        self.simulation = simulation if simulation is not None else Simulation()
        self._clock = 0.0  # seconds of wall time accumulated through advance()
        self._loop = RealtimeLoop(self.simulation, self._clock)

    def hello(self) -> str:
        """JSON text of the ``hello`` frame (send it first)."""
        return encode(self.simulation.hello())

    def receive(self, text: str) -> None:
        """Handle one client JSON frame. Invalid or unknown input is ignored."""
        self._loop.receive(text)

    def advance(self, elapsed_s: float) -> list[str]:
        """Let ``elapsed_s`` seconds of wall time pass and return the frames to send, in order.

        Serial lines and events come first, then a ``state`` frame when 1/30 s has elapsed since
        the previous one. A stall longer than the catch-up cap is dropped, not replayed.
        """
        if not isinstance(elapsed_s, (int, float)) or not math.isfinite(elapsed_s):
            elapsed_s = 0.0
        self._clock += max(0.0, float(elapsed_s))
        return [encode(message) for message in self._loop.tick(self._clock)]
