"""Extract the EcoKar App Inventor assets used by the simulator UI.

The original mobile app (``info/Ekocar_Final.aia``) is the single source of
truth for branding: logo, school crest, background and button artwork. This
script copies them into the static folder under stable, descriptive names.
"""

from __future__ import annotations

import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AIA_PATH = ROOT / "info" / "Ekocar_Final.aia"
TARGET_DIR = ROOT / "src" / "ecokar_sim" / "static" / "assets"

# App Inventor asset name -> simulator asset name
ASSET_MAP: dict[str, str] = {
    "EcoKar.png": "ecokar-logo.png",
    "LINED.png": "ined-crest.png",
    "FONDO.avif": "app-background.avif",
    "WhatsAppImage2026-10-16at9.40.08PM.jpeg": "arm-button.jpg",
    "Gemini_Generated_Image_4ymfvi4ymfvi4ymf.jpg": "arrow-up.jpg",
    "Flechaabajo.jpg": "arrow-down.jpg",
    "Flechaizquierda.jpg": "arrow-left.jpg",
    "Flechaderecha.jpg": "arrow-right.jpg",
    "brazorobotico": "arm-illustration.png",
}


def extract(aia_path: Path = AIA_PATH, target_dir: Path = TARGET_DIR) -> list[Path]:
    if not aia_path.is_file():
        raise FileNotFoundError(f"App Inventor project not found: {aia_path}")

    target_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    with zipfile.ZipFile(aia_path) as archive:
        for source_name, target_name in ASSET_MAP.items():
            data = archive.read(f"assets/{source_name}")
            destination = target_dir / target_name
            destination.write_bytes(data)
            written.append(destination)
    return written


def main() -> int:
    try:
        written = extract()
    except (FileNotFoundError, KeyError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    for path in written:
        print(f"  {path.relative_to(ROOT)}")
    print(f"Extracted {len(written)} assets from {AIA_PATH.name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
