"""Refresh official Indian store prices in data/products.json.

The deployed backend also refreshes prices in DynamoDB every day (see price_job.py), so this is for keeping
the data file current before a seed. Prices older than 7 days are ignored by the API.
    python scripts/refresh_prices.py
    python scripts/seed.py

A price that cannot be read is left unchanged and reported, never guessed.
"""

import json
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend" / "src"))

from prices import refresh  # noqa: E402
from validate_data import DATA_DIR  # noqa: E402


def main():
    path = DATA_DIR / "products.json"
    products = json.loads(path.read_text(encoding="utf-8"))
    updates, failures = refresh(products, date.today().isoformat())

    for product in products:
        if product["modelId"] in updates:
            product["priceInr"] = updates[product["modelId"]]
            print(f"UPDATED {product['modelId']}: Rs {product['priceInr']['value']:,}")
    for model_id, reason in failures.items():
        print(f"KEPT    {model_id}: {reason}")

    path.write_text(json.dumps(products, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
