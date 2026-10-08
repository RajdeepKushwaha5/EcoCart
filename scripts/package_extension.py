"""Build the zip to upload to the Chrome Web Store or Edge Add-ons: manifest.json at the root, no tests.

Run: python scripts/package_extension.py
Writes dist/ecocart-<version>.zip. Raise "version" in extension/manifest.json before each new upload.
"""

import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXTENSION = ROOT / "extension"
SKIP = {"tests"}


def main():
    manifest = json.loads((EXTENSION / "manifest.json").read_text(encoding="utf-8"))
    config = (EXTENSION / "config.js").read_text(encoding="utf-8")
    if "localhost" in config.split("API_BASE_URL")[1].split("\n")[0]:
        raise SystemExit("config.js points at localhost. Set the live API address first.")

    target = ROOT / "dist" / f"ecocart-{manifest['version']}.zip"
    target.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(EXTENSION.rglob("*")):
            relative = path.relative_to(EXTENSION)
            if path.is_file() and relative.parts[0] not in SKIP:
                archive.write(path, relative.as_posix())
    print(f"Wrote {target.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
