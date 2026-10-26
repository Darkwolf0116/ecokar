"""FastAPI adapter: the ONLY module that imports FastAPI.

* ``GET /``            -> ``static/index.html``
* ``/static/...``      -> the static folder (assets, vendor libraries, js, css)
* ``GET /api/health``  -> ``{"status": "ok"}``
* ``GET /static/build.json`` -> ``{"engine": "server"}`` (engine probe of the frontend)
* ``WS  /ws``          -> one independent simulation per connection (see docs/protocol.md)

``index.html`` is served from ``/``, so its resources must use absolute ``/static/...`` URLs.
"""

from __future__ import annotations

import contextlib
import mimetypes
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.websockets import WebSocketState

from .session import ConnectionClosed, SimulationSession

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

# Windows reads MIME types from the registry, where .js is sometimes "text/plain", which
# browsers refuse for ES modules. Pin the types the frontend needs.
for _suffix, _mime in {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".avif": "image/avif",
    ".woff2": "font/woff2",
    ".json": "application/json",
}.items():
    mimetypes.add_type(_mime, _suffix)


class _WebSocketTransport:
    """Adapts a Starlette WebSocket to the session's Transport protocol."""

    def __init__(self, websocket: WebSocket) -> None:
        self._ws = websocket

    async def send_text(self, data: str) -> None:
        try:
            await self._ws.send_text(data)
        except (WebSocketDisconnect, RuntimeError) as error:
            raise ConnectionClosed from error

    async def receive_text(self) -> str | None:
        while True:
            try:
                message = await self._ws.receive()
            except (WebSocketDisconnect, RuntimeError):
                return None
            if message["type"] == "websocket.disconnect":
                return None
            text = message.get("text")
            if text is not None:
                return text
            # binary frames are not part of the protocol: ignore them


def create_app(static_dir: Path | None = None) -> FastAPI:
    static_root = static_dir if static_dir is not None else STATIC_DIR
    app = FastAPI(title="EcoKar Sim", docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/api/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/static/build.json", include_in_schema=False)
    async def build_info() -> dict[str, str]:
        # The frontend probes this file to choose its engine. The static (Vercel) build ships a
        # file with "pyodide"; answering here keeps the local server from logging a 404.
        return {"engine": "server"}

    @app.get("/", include_in_schema=False)
    async def index() -> Response:
        page = static_root / "index.html"
        if page.is_file():
            return FileResponse(page, headers={"Cache-Control": "no-cache"})
        return HTMLResponse(
            "<h1>EcoKar Sim</h1><p>Frontend no encontrado: falta static/index.html.</p>",
            status_code=404,
        )

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket) -> None:
        await websocket.accept()
        session = SimulationSession()
        try:
            await session.run(_WebSocketTransport(websocket))
        finally:
            if websocket.application_state == WebSocketState.CONNECTED:
                with contextlib.suppress(RuntimeError, WebSocketDisconnect):
                    await websocket.close()

    app.mount("/static", StaticFiles(directory=static_root), name="static")
    return app


app = create_app()
