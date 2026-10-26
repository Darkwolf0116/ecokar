"""Shared test helpers: emulate the MIT App Inventor app on top of a Simulation."""

from __future__ import annotations

from typing import Any

from ecokar_sim import config
from ecokar_sim.firmware.controller import FirmwareController
from ecokar_sim.simulation import Simulation

DT = config.SIM_DT_S
REPEAT_STEPS = round(config.APP_REPEAT_MS / 1000 / DT)


def connected_sim(seed: int | None = None) -> Simulation:
    sim = Simulation(seed)
    sim.connect()
    sim.drain_outbox()
    return sim


def hold(sim: Simulation, char: str, seconds: float, release: bool = True) -> None:
    """Hold a button: send the letter at once and every 100 ms, then 'S' on release."""
    for index in range(round(seconds / DT)):
        if index % REPEAT_STEPS == 0:
            sim.transmit(char)
        sim.step()
    if release:
        sim.transmit("S")
        sim.step()


def serial_lines(sim: Simulation) -> list[str]:
    return [m["line"] for m in sim.drain_outbox() if m["type"] == "serial"]


def events(messages: list[dict[str, Any]], name: str) -> list[dict[str, Any]]:
    return [m for m in messages if m["type"] == "event" and m["name"] == name]


def tick_firmware(fw: FirmwareController, ticks: int) -> None:
    for _ in range(ticks):
        fw.tick(config.RAMP_INTERVAL_MS)


def lines_of(fw: FirmwareController) -> list[str]:
    return [line.text for line in fw.drain_serial()]
