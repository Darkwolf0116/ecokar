#!/usr/bin/env python3
"""Build the static (Vercel) site into ``dist/``. Standard library only: runs with plain python3.

``dist/`` layout::

    index.html                     copy of src/ecokar_sim/static/index.html
    static/**                      copy of the whole static folder
    static/py/ecokar_sim.zip       the pure-Python core (no server/, __main__.py, static/)
    static/build.json              {"engine": "pyodide", "pyodide": "<version>", "built_at": ...}

The frontend reads ``static/build.json`` to pick the in-browser engine instead of the WebSocket
server. The Pyodide version is read from ``static/js/net/pyodide-worker.js`` (single source).

Usage: ``python3 scripts/build_web.py`` (``make web`` runs it through uv).
"""

from __future__ import annotations

import json
import re
import shutil
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PACKAGE_DIR = ROOT / "src" / "ecokar_sim"
STATIC_DIR = PACKAGE_DIR / "static"
WORKER_JS = STATIC_DIR / "js" / "net" / "pyodide-worker.js"
DIST_DIR = ROOT / "dist"

PACKAGE_NAME = "ecokar_sim"
ZIP_RELATIVE = Path("static") / "py" / f"{PACKAGE_NAME}.zip"
EXCLUDED_TOP_LEVEL = {"server", "static"}  # relative to the package
EXCLUDED_FILES = {"__main__.py"}  # the CLI imports uvicorn
EXCLUDED_ANYWHERE = {"__pycache__"}
REQUIRED_IN_ZIP = (
    "ecokar_sim/__init__.py",
    "ecokar_sim/simulation.py",
    "ecokar_sim/browser/bridge.py",
)
FORBIDDEN_IMPORT = re.compile(
    r"^\s*(?:from|import)\s+(?:fastapi|uvicorn|starlette)\b", re.MULTILINE
)
ZIP_TIMESTAMP = (2020, 1, 1, 0, 0, 0)  # fixed so identical sources give an identical zip


class BuildError(Exception):
    """A build step failed; the message says what to fix."""


def pyodide_version() -> str:
    match = re.search(r"""PYODIDE_VERSION\s*=\s*['"]([^'"]+)['"]""", WORKER_JS.read_text("utf-8"))
    if match is None:
        raise BuildError(f"PYODIDE_VERSION not found in {WORKER_JS.relative_to(ROOT)}")
    return match.group(1)


def core_files() -> list[Path]:
    """Python files of the package that the browser needs, in a stable order."""
    files = []
    for path in sorted(PACKAGE_DIR.rglob("*.py")):
        parts = path.relative_to(PACKAGE_DIR).parts
        if parts[0] in EXCLUDED_TOP_LEVEL or EXCLUDED_ANYWHERE.intersection(parts):
            continue
        if len(parts) == 1 and parts[0] in EXCLUDED_FILES:
            continue
        files.append(path)
    return files


def build_zip(target: Path) -> list[str]:
    target.parent.mkdir(parents=True, exist_ok=True)
    names = []
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in core_files():
            source = path.read_text("utf-8")
            if FORBIDDEN_IMPORT.search(source):
                relative = path.relative_to(PACKAGE_DIR)
                raise BuildError(
                    f"{relative} imports a web framework; it cannot run in the browser"
                )
            name = f"{PACKAGE_NAME}/{path.relative_to(PACKAGE_DIR).as_posix()}"
            info = zipfile.ZipInfo(name, ZIP_TIMESTAMP)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            archive.writestr(info, source.replace("\r\n", "\n").encode("utf-8"))
            names.append(name)
    missing = [name for name in REQUIRED_IN_ZIP if name not in names]
    if missing:
        raise BuildError(f"the core zip is missing: {', '.join(missing)}")
    return names


def clean(directory: Path) -> None:
    if directory.parent != ROOT:  # never delete anything but <root>/dist
        raise BuildError(f"refusing to clean {directory}")
    if directory.exists():
        shutil.rmtree(directory)
    directory.mkdir()


def human(size: int) -> str:
    return f"{size / 1024:.1f} KiB" if size < 1024 * 1024 else f"{size / 1024 / 1024:.2f} MiB"


def build() -> None:
    for required in (STATIC_DIR / "index.html", WORKER_JS):
        if not required.is_file():
            raise BuildError(f"missing {required.relative_to(ROOT)}")
    version = pyodide_version()

    clean(DIST_DIR)
    shutil.copytree(STATIC_DIR, DIST_DIR / "static", ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copyfile(STATIC_DIR / "index.html", DIST_DIR / "index.html")
    names = build_zip(DIST_DIR / ZIP_RELATIVE)

    info = {
        "engine": "pyodide",
        "pyodide": version,
        "built_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),  # noqa: UP017
    }
    (DIST_DIR / "static" / "build.json").write_text(
        json.dumps(info, indent=2) + "\n", encoding="utf-8"
    )

    files = [p for p in DIST_DIR.rglob("*") if p.is_file()]
    total = sum(p.stat().st_size for p in files)
    zip_size = (DIST_DIR / ZIP_RELATIVE).stat().st_size
    print(f"Static build ready in {DIST_DIR.relative_to(ROOT)}/ (Pyodide {version})")
    print(f"  files : {len(files)} ({human(total)})")
    print(f"  core  : {ZIP_RELATIVE.as_posix()} - {len(names)} modules, {human(zip_size)}")


def main() -> int:
    try:
        build()
    except (BuildError, OSError) as error:
        print(f"build_web.py: error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
