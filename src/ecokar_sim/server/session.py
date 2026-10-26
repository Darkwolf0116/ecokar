"""Real-time loop of one browser connection (framework-free, transport injected).

Each connection owns its own :class:`~ecokar_sim.simulation.Simulation`. The pacing itself
(fixed 10 ms physics step fed by an accumulator on ``time.perf_counter``, ``state`` frames at
~30 Hz, serial lines and events flushed on every tick) lives in
:class:`~ecokar_sim.realtime.RealtimeLoop`, which the in-browser Pyodide bridge shares. This
module only adds the asyncio plumbing: a reader task handles client messages concurrently
with the tick loop.
"""

from __future__ import annotations

import asyncio
import contextlib
import time
from collections.abc import Callable
from typing import Protocol

from .. import config
from ..realtime import RealtimeLoop
from ..serialization import encode
from ..simulation import Simulation


class ConnectionClosed(Exception):
    """Raised by a transport when the peer is gone."""


class Transport(Protocol):
    """What the session needs from a WebSocket."""

    async def send_text(self, data: str) -> None:
        """Send one text frame; raise :class:`ConnectionClosed` if the peer is gone."""
        ...

    async def receive_text(self) -> str | None:
        """Next text frame, or None once the peer disconnected."""
        ...


class SimulationSession:
    """Drives one simulation over one transport until the peer disconnects."""

    def __init__(
        self,
        simulation: Simulation | None = None,
        clock: Callable[[], float] = time.perf_counter,
    ) -> None:
        self.simulation = simulation if simulation is not None else Simulation()
        self._clock = clock
        self._loop = RealtimeLoop(self.simulation, self._clock())

    async def run(self, transport: Transport) -> None:
        reader: asyncio.Task[None] | None = None
        try:
            await transport.send_text(encode(self.simulation.hello()))
            self._loop = RealtimeLoop(self.simulation, self._clock())  # anchor the clock here
            reader = asyncio.create_task(self._read_loop(transport))
            await self._tick_loop(transport, reader)
        except ConnectionClosed:
            pass
        finally:
            if reader is not None:
                reader.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await reader

    # ------------------------------------------------------------------ reading
    async def _read_loop(self, transport: Transport) -> None:
        while True:
            text = await transport.receive_text()
            if text is None:
                return
            self._loop.receive(text)

    # ------------------------------------------------------------------ ticking
    async def _tick_loop(self, transport: Transport, reader: asyncio.Task[None]) -> None:
        dt = config.SIM_DT_S
        while not reader.done():
            now = self._clock()
            for message in self._loop.tick(now):
                await transport.send_text(encode(message))
            await asyncio.sleep(max(0.001, dt - (self._clock() - now)))
