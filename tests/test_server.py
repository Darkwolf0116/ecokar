"""HTTP and WebSocket adapter tests (FastAPI TestClient, real-time loop)."""

import time

import pytest
from fastapi.testclient import TestClient

from ecokar_sim.server.app import create_app


@pytest.fixture
def static_dir(tmp_path):
    (tmp_path / "index.html").write_text("<!doctype html><title>EcoKar</title>", encoding="utf-8")
    (tmp_path / "js").mkdir()
    (tmp_path / "js" / "main.js").write_text("export const ready = true;\n", encoding="utf-8")
    return tmp_path


@pytest.fixture
def client(static_dir):
    with TestClient(create_app(static_dir)) as test_client:
        yield test_client


def read_until(ws, predicate, timeout=5.0):
    """Receive frames until one satisfies ``predicate``; return it (fail on timeout)."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        message = ws.receive_json()
        if predicate(message):
            return message
    raise AssertionError("expected frame not received in time")


def first_state(ws):
    return read_until(ws, lambda m: m["type"] == "state")


# ----------------------------------------------------------------------------- HTTP
def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_root_serves_index_html(client):
    response = client.get("/")
    assert response.status_code == 200
    assert "<title>EcoKar</title>" in response.text
    assert response.headers["content-type"].startswith("text/html")


def test_build_json_tells_the_frontend_to_use_the_server_engine(client):
    response = client.get("/static/build.json")
    assert response.status_code == 200
    assert response.json() == {"engine": "server"}


def test_root_without_frontend_is_a_clear_404(tmp_path):
    with TestClient(create_app(tmp_path)) as test_client:
        response = test_client.get("/")
    assert response.status_code == 404
    assert "index.html" in response.text


def test_static_files_are_served_with_a_module_mime_type(client):
    response = client.get("/static/js/main.js")
    assert response.status_code == 200
    assert "ready" in response.text
    assert "javascript" in response.headers["content-type"]
    assert client.get("/static/missing.js").status_code == 404


def test_default_app_serves_the_packaged_static_folder():
    from ecokar_sim.server.app import STATIC_DIR, app

    assert (STATIC_DIR / "assets").is_dir()
    with TestClient(app) as test_client:
        assert test_client.get("/static/assets/ecokar-logo.png").status_code == 200


# ----------------------------------------------------------------------------- WebSocket
def test_hello_is_the_first_frame(client):
    with client.websocket_connect("/ws") as ws:
        hello = ws.receive_json()
    assert hello["type"] == "hello"
    assert hello["version"] == 1
    assert len(hello["world"]["trash"]) == 8
    assert len(hello["protocol"]["commands"]) == 12
    assert hello["protocol"]["timeout_ms"] == 400


def test_state_frames_stream_at_a_moderate_rate(client):
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()  # hello
        start = time.monotonic()
        states = [first_state(ws) for _ in range(10)]
        elapsed = time.monotonic() - start
    assert states[-1]["t"] > states[0]["t"]
    assert elapsed < 2.0  # 10 frames at ~30 Hz


def test_connect_then_repeated_a_moves_the_robot_forward(client):
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()
        x0 = first_state(ws)["robot"]["x"]
        ws.send_json({"type": "bt_connect"})

        deadline = time.monotonic() + 6.0
        next_send = 0.0
        latest = None
        serial = []
        while time.monotonic() < deadline:
            now = time.monotonic()
            if now >= next_send:
                ws.send_json({"type": "tx", "data": "A"})
                next_send = now + 0.1
            message = ws.receive_json()
            if message["type"] == "serial":
                serial.append(message["line"])
            elif message["type"] == "state":
                latest = message
                if latest["robot"]["x"] > x0 + 0.1:
                    break
        assert latest is not None
        assert latest["connected"] is True
        assert latest["robot"]["x"] > x0 + 0.1
        assert latest["drive"]["command"] == "A"
        assert latest["drive"]["left_pwm"] > 0
        assert latest["drive"]["pins"]["IN1"] == 1
        assert "[BT] Conectado" in serial
        assert "[CMD] A" in serial


def test_serial_and_event_frames_have_the_contract_shape(client):
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.send_json({"type": "bt_connect"})
        serial = read_until(ws, lambda m: m["type"] == "serial")
        assert set(serial) == {"type", "t", "line"}
        assert serial["line"] == "Carrito BT listo. Comandos: A B C D S"

        # Drive into the road boundary behind the spawn point to provoke a collision event.
        deadline = time.monotonic() + 15.0
        event = None
        next_send = 0.0
        while time.monotonic() < deadline and event is None:
            now = time.monotonic()
            if now >= next_send:
                ws.send_json({"type": "tx", "data": "B"})
                next_send = now + 0.1
            message = ws.receive_json()
            if message["type"] == "event" and message["name"] == "collision":
                event = message
        assert event is not None
        assert set(event) == {"type", "t", "name", "data"}
        assert event["data"]["with"] == "road"


def test_tx_is_ignored_while_disconnected(client):
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()
        x0 = first_state(ws)["robot"]["x"]
        deadline = time.monotonic() + 0.8
        latest = None
        next_send = 0.0
        while time.monotonic() < deadline:
            now = time.monotonic()
            if now >= next_send:
                ws.send_json({"type": "tx", "data": "A"})
                next_send = now + 0.1
            message = ws.receive_json()
            assert message["type"] != "serial"
            if message["type"] == "state":
                latest = message
        assert latest is not None
        assert latest["robot"]["x"] == x0
        assert latest["connected"] is False
        assert latest["drive"]["left_target"] == 0


def test_invalid_input_never_breaks_the_loop(client):
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.send_text("this is not json")
        ws.send_text("[1, 2, 3]")
        ws.send_text('"a string"')
        ws.send_json({"type": "unknown"})
        ws.send_json({"type": "tx", "data": 123})
        ws.send_json({"no_type": True})
        ws.send_bytes(b"\x00\x01")
        ws.send_json({"type": "bt_connect"})
        assert read_until(ws, lambda m: m["type"] == "state" and m["connected"])["connected"]


def test_reset_keeps_the_connection(client):
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()
        x0 = first_state(ws)["robot"]["x"]
        ws.send_json({"type": "bt_connect"})
        deadline = time.monotonic() + 6.0
        next_send = 0.0
        moved = False
        while time.monotonic() < deadline and not moved:
            now = time.monotonic()
            if now >= next_send:
                ws.send_json({"type": "tx", "data": "A"})
                next_send = now + 0.1
            message = ws.receive_json()
            moved = message["type"] == "state" and message["robot"]["x"] > x0 + 0.1
        assert moved
        ws.send_json({"type": "reset"})
        state = read_until(ws, lambda m: m["type"] == "state" and m["robot"]["x"] == x0)
        assert state["connected"] is True
        assert state["mission"]["elapsed_s"] == 0.0


def test_each_connection_has_its_own_robot(client):
    with client.websocket_connect("/ws") as first, client.websocket_connect("/ws") as second:
        first.receive_json()
        second.receive_json()
        first.send_json({"type": "bt_connect"})
        deadline = time.monotonic() + 6.0
        moved = False
        next_send = 0.0
        while time.monotonic() < deadline and not moved:
            now = time.monotonic()
            if now >= next_send:
                first.send_json({"type": "tx", "data": "A"})
                next_send = now + 0.1
            message = first.receive_json()
            moved = message["type"] == "state" and message["robot"]["x"] > -4.3
        assert moved
        other = first_state(second)
        assert other["robot"]["x"] == -4.5
        assert other["connected"] is False


def test_disconnect_message_reports_in_serial(client):
    with client.websocket_connect("/ws") as ws:
        ws.receive_json()
        ws.send_json({"type": "bt_connect"})
        ws.send_json({"type": "bt_disconnect"})
        lines = []
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline and "[BT] Desconectado" not in lines:
            message = ws.receive_json()
            if message["type"] == "serial":
                lines.append(message["line"])
        assert lines == [
            "Carrito BT listo. Comandos: A B C D S",
            "[BT] Conectado",
            "[BT] Desconectado",
        ]
