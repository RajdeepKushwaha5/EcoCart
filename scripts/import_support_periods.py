"""Import makers' official per-model security update lists into data/support_periods.json.

Sources, each published by the maker itself:
  Xiaomi, Redmi, POCO  Product Software Support Information (JSON feed behind the page)
  realme               UK PSTI product security update period table
  OnePlus              UK PSTI table. The page builds the table in the browser, so pass a saved copy of its text:
                       open https://www.oneplus.com/uk/psti, select all, save as a .txt file

Run: python scripts/import_support_periods.py [--oneplus-text research/oneplus-psti.txt]
Every row keeps the source URL and the date it was checked. Models already in data/products.json are left to that file.
"""

import argparse
import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "data" / "support_periods.json"
sys.path.insert(0, str(ROOT / "backend" / "src"))

from support_lists import deduplicate, oneplus, realme, xiaomi  # noqa: E402


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--oneplus-text", help="Saved text of the OnePlus UK PSTI page")
    args = parser.parse_args()

    checked = date.today().isoformat()
    rows = xiaomi(checked) + realme(checked)
    if args.oneplus_text:
        rows += oneplus(Path(args.oneplus_text).read_text(encoding="utf-8"), checked)
    elif OUTPUT.exists():
        # Keep the last OnePlus import rather than dropping it.
        rows += [item for item in json.loads(OUTPUT.read_text(encoding="utf-8")) if item["brand"] == "OnePlus"]

    rows = [item for item in deduplicate(rows) if item["supportEndDate"] >= checked]
    OUTPUT.write_text(json.dumps(rows, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    counts = {}
    for item in rows:
        counts[item["brand"]] = counts.get(item["brand"], 0) + 1
    print(f"Wrote {len(rows)} models still in support: {counts}")


if __name__ == "__main__":
    main()
