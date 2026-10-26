"""In-browser (Pyodide) bridge: same protocol as the WebSocket server, driven by advance()."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from ecokar_sim import config
from ecokar_sim.browser.bridge import BrowserSession
from ecokar_sim.serialization import encode
from ecokar_sim.server.app import create_app
from ecokar_sim.simulation import Simulation

TICK_S = 0.01  # the worker's timer period
BANNER = "Carrito BT listo. Comandos: A B C D S"


def parse(frames: list[str]) -> list[dict]:
    return [json.loads(frame) for frame in frames]


def run(session: BrowserSession, seconds: float, tick: float = TICK_S) -> list[dict]:
    """Advance ``seconds`` of wall time in ``tick`` slices; return every frame produced."""
    frames: list[str] = []
    for _ in range(round(seconds / tick)):
        frames.extend(session.advance(tick))
    return parse(frames)


def hold(session: BrowserSession, char: str, seconds: float) -> list[dict]:
    """Emulate the app: send the letter every 100 ms of advanced time while it is held."""
    messages: list[dict] = []
    repeat = round(config.APP_REPEAT_MS / 1000 / TICK_S)
    for index in range(round(seconds / TICK_S)):
        if index % repeat == 0:
            session.receive(json.dumps({"type": "tx", "data": char}))
        messages.extend(parse(session.advance(TICK_S)))
    return messages


def states(messages: list[dict]) -> list[dict]:
    return [m for m in messages if m["type"] == "state"]


# --------------------------------------------------------------------------------- hello
def test_hello_is_json_text_identical_to_the_server_hello():
    text = BrowserSession().hello()
    assert isinstance(text, str)
    assert text == encode(Simulation().hello())
    hello = json.loads(text)
    assert hello["type"] == "hello"
    assert hello["version"] == config.PROTOCOL_VERSION
    assert len(hello["world"]["trash"]) == 8
    assert len(hello["protocol"]["commands"]) == 12
    assert hello["protocol"]["timeout_ms"] == config.COMMAND_TIMEOUT_MS


def test_hello_equals_what_the_websocket_server_sends(tmp_path):
    (tmp_path / "index.html").write_text("<!doctype html>", encoding="utf-8")
    with TestClient(create_app(tmp_path)) as client, client.websocket_connect("/ws") as ws:
        assert ws.receive_text() == BrowserSession().hello()


# ------------------------------------------------------------------------------- driving
def test_connect_and_repeated_a_moves_the_robot_and_prints_the_banner():
    session = BrowserSession()
    x0 = states(run(session, 0.05))[-1]["robot"]["x"]
    assert x0 == -4.5

    session.receive('{"type": "bt_connect"}')
    messages = hold(session, "A", 1.0)

    latest = states(messages)[-1]
    assert latest["connected"] is True
    assert latest["robot"]["x"] > x0 + 0.1
    assert latest["drive"]["command"] == "A"
    assert latest["drive"]["pins"]["IN1"] == 1
    lines = [m["line"] for m in messages if m["type"] == "serial"]
    assert lines[:2] == [BANNER, "[BT] Conectado"]
    assert "[CMD] A" in lines


def test_serial_frames_have_the_contract_shape():
    session = BrowserSession()
    session.receive('{"type": "bt_connect"}')
    frames = session.advance(TICK_S)
    serial = json.loads(frames[0])
    assert set(serial) == {"type", "t", "line"}
    assert serial["line"] == BANNER
    assert json.loads(frames[-1])["type"] == "state"  # the outbox comes first, then the state


def test_tx_is_ignored_while_disconnected():
    session = BrowserSession()
    messages = hold(session, "A", 0.5)
    assert all(m["type"] == "state" for m in messages)
    assert states(messages)[-1]["robot"]["x"] == -4.5
    assert states(messages)[-1]["connected"] is False


def test_dead_man_timeout_stops_the_robot_when_the_letters_stop():
    session = BrowserSession()
    session.receive('{"type": "bt_connect"}')
    hold(session, "A", 0.5)
    messages = run(session, 1.0)
    lines = [m["line"] for m in messages if m["type"] == "serial"]
    assert "[SEG] Timeout de comando: parada" in lines
    assert states(messages)[-1]["drive"]["left_pwm"] == 0


# --------------------------------------------------------------------------------- cadence
def test_state_frames_arrive_at_about_30_hz():
    session = BrowserSession()
    count = len(states(run(session, 1.0)))
    assert 28 <= count <= 32


def test_a_coarse_timer_still_gives_one_state_per_tick_and_the_same_physics():
    fine = BrowserSession()
    coarse = BrowserSession()
    for session in (fine, coarse):
        session.receive('{"type": "bt_connect"}')
    run(fine, 1.0, tick=0.01)
    coarse_states = states(run(coarse, 1.0, tick=0.1))  # 100 ms ticks: 10 catch-up steps each
    assert len(coarse_states) == 10
    assert fine.simulation.time == pytest.approx(coarse.simulation.time, abs=2 * config.SIM_DT_S)


def test_a_long_stall_is_dropped_instead_of_replayed():
    session = BrowserSession()
    frames = session.advance(30.0)  # e.g. a throttled background tab
    assert session.simulation.time == pytest.approx(config.MAX_CATCHUP_STEPS * config.SIM_DT_S)
    assert [json.loads(f)["type"] for f in frames] == ["state"]


@pytest.mark.parametrize("bad", [-1.0, float("nan"), float("inf"), None, "0.01"])
def test_invalid_elapsed_time_never_raises_or_advances_the_world(bad):
    session = BrowserSession()
    session.advance(bad)
    assert session.simulation.time == 0.0


# ------------------------------------------------------------------------------- robustness
def test_garbage_input_is_ignored():
    session = BrowserSession()
    for garbage in (
        "this is not json",
        "[1, 2, 3]",
        '"a string"',
        "null",
        "[" * 100_000,
        '{"type": "unknown"}',
        '{"type": "tx", "data": 123}',
        '{"no_type": true}',
        "",
        None,
        b"\x00\x01",
        123,
    ):
        session.receive(garbage)  # type: ignore[arg-type]
    assert states(run(session, 0.1))[-1]["connected"] is False

    session.receive('{"type": "bt_connect"}')
    assert states(run(session, 0.1))[-1]["connected"] is True


def test_every_frame_is_compact_json_text_like_the_server_sends():
    session = BrowserSession()
    session.receive('{"type": "bt_connect"}')
    frames = session.advance(0.05) + [session.hello()]
    assert frames
    for frame in frames:
        assert isinstance(frame, str)
        assert encode(json.loads(frame)) == frame


# ------------------------------------------------------------------------------------ reset
def test_reset_gives_a_new_mission_and_keeps_the_bluetooth_link():
    session = BrowserSession()
    session.receive('{"type": "bt_connect"}')
    moved = states(hold(session, "A", 1.0))[-1]
    assert moved["robot"]["x"] > -4.4
    assert moved["mission"]["elapsed_s"] > 0

    session.receive('{"type": "reset"}')
    messages = run(session, 0.05)
    after = states(messages)[-1]
    assert after["robot"]["x"] == -4.5
    assert after["connected"] is True
    assert after["mission"]["elapsed_s"] == 0.0
    assert [m["line"] for m in messages if m["type"] == "serial"][:1] == [BANNER]
