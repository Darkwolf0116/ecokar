"""Command line entry point: ``ecokar-sim [--host H] [--port P] [--open]``."""

from __future__ import annotations

import argparse
import threading
import webbrowser
from collections.abc import Sequence

import uvicorn


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="ecokar-sim",
        description="EcoKar digital twin: web 3D simulator of the Bluetooth robot car.",
    )
    parser.add_argument(
        "--host", default="127.0.0.1", help="interface to bind (default: 127.0.0.1)"
    )
    parser.add_argument("--port", type=int, default=8000, help="TCP port (default: 8000)")
    parser.add_argument(
        "--open", action="store_true", help="open the browser when the server starts"
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(argv)

    # Imported here so that `--help` stays instant and import errors surface after parsing.
    from .server.app import app

    if args.open:
        browse_host = "127.0.0.1" if args.host in ("0.0.0.0", "::") else args.host
        url = f"http://{browse_host}:{args.port}/"
        threading.Timer(1.0, webbrowser.open, args=(url,)).start()

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
