"""Review a draft from the catalog research team (agents/) and add it to data/products.json.

Shows every quote next to the fact it supports, runs the same checks as validate_data.py, and asks for a yes
before writing anything. The draft file is removed once it is merged.

Run: python scripts/approve_draft.py drafts/oneplus-13r.json [--replace]
"""

import argparse
import json
import sys
from pathlib import Path

from validate_data import DATA_DIR, check_products

PRODUCTS = DATA_DIR / "products.json"


def show_review(draft):
    review = draft["_review"]
    print(f"\n{draft['displayName']} ({draft['brand']}, {draft['category']})  id: {draft['modelId']}")
    print(f"  aliases: {draft['aliases']}   model numbers: {draft['modelNumbers'] or 'none'}")
    for key in ("updatePolicy", "lifecycleCo2eKg", "takeBack"):
        fact = draft.get(key)
        if fact is None:
            print(f"  {key}: none")
            continue
        quote = review["quotes"].get(key, {})
        shown = {name: value for name, value in fact.items() if name not in ("source", "checked")}
        print(f"  {key}: {shown}")
        print(f"      quote: \"{quote.get('quote')}\"")
        print(f"      source: {fact['source']} (checked {fact['checked']})")
    for note in review["notes"]:
        print(f"  note: {note}")
    print("\nAlso check the aliases and add 'excludes' for close model names (Pro, Plus, Lite) before approving.")


def merge(draft, products, replace=False):
    """Return the new product list, or raise ValueError with the reasons it cannot be merged."""
    entry = {key: value for key, value in draft.items() if key != "_review"}
    if not any(entry.get(key) for key in ("updatePolicy", "lifecycleCo2eKg", "takeBack")):
        raise ValueError("The draft has no verified facts, so there is nothing to add.")
    existing = [product for product in products if product["modelId"] == entry["modelId"]]
    if existing and not replace:
        raise ValueError(f"{entry['modelId']} is already in the catalog. Use --replace to overwrite it.")
    updated = [product for product in products if product["modelId"] != entry["modelId"]] + [entry]
    errors = check_products(updated)
    if errors:
        raise ValueError("\n".join(errors))
    return updated


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("draft", type=Path)
    parser.add_argument("--replace", action="store_true", help="Overwrite a catalog entry with the same modelId")
    args = parser.parse_args()

    draft = json.loads(args.draft.read_text(encoding="utf-8"))
    show_review(draft)
    products = json.loads(PRODUCTS.read_text(encoding="utf-8"))
    try:
        updated = merge(draft, products, args.replace)
    except ValueError as error:
        sys.exit(f"\nNot merged:\n{error}")

    if input("\nAdd this entry to data/products.json? Type yes to confirm: ").strip().lower() != "yes":
        sys.exit("Not merged.")
    PRODUCTS.write_text(json.dumps(updated, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    args.draft.unlink()
    print("Merged. Run seed.py to publish it.")


if __name__ == "__main__":
    main()
