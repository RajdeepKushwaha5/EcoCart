"""Turn makers' official support lists (data/support_periods.json) into catalog entries.

Each entry carries one sourced fact, the security update end date, so it gets a passport card and a search badge.
Devices in data/products.json are curated by hand and always win over a generated entry for the same model.
"""

import json
import sys
from pathlib import Path

from validate_data import DATA_DIR

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend" / "src"))

from support_lists import catalog_entries  # noqa: E402,F401  (also used by tests through this module)


def load_rows():
    path = DATA_DIR / "support_periods.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []


def full_catalog(curated):
    return curated + catalog_entries(load_rows(), curated)
