"""Check the files in data/ before seeding.

Every fact that has a value must carry a source URL and a checked date (YYYY-MM-DD).
Run: python scripts/validate_data.py
"""

import json
import re
import sys
from datetime import date
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
FACT_KEYS = ["priceInr", "updatePolicy", "repairability", "lifecycleCo2eKg", "takeBack"]
OPTION_TYPES = {"exchange", "recycle", "reuse"}
CATEGORIES = {"phone", "laptop", "tablet", "watch", "earbuds", "tv", "appliance", "electronics"}
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MONTH_PATTERN = re.compile(r"^\d{4}-\d{2}(-\d{2})?$")


def _valid_date(text):
    if not isinstance(text, str) or not DATE_PATTERN.match(text):
        return False
    try:
        date.fromisoformat(text)
    except ValueError:
        return False
    return True


def _check_source(label, record, errors):
    source = record.get("source")
    if not isinstance(source, str) or not source.startswith("https://"):
        errors.append(f"{label}: 'source' must be an https:// URL")
    if not _valid_date(record.get("checked")):
        errors.append(f"{label}: 'checked' must be a real date in YYYY-MM-DD form")


def check_products(products):
    errors = []
    seen = set()
    for index, product in enumerate(products):
        label = product.get("modelId", f"product #{index}")
        for key in ("modelId", "brand", "displayName"):
            if not isinstance(product.get(key), str) or not product[key].strip():
                errors.append(f"{label}: '{key}' is required")
        if label in seen:
            errors.append(f"{label}: duplicate modelId")
        seen.add(label)
        if product.get("category", "phone") not in CATEGORIES:
            errors.append(f"{label}: 'category' must be one of {sorted(CATEGORIES)}")
        if not product.get("aliases") and not product.get("modelNumbers"):
            errors.append(f"{label}: needs at least one alias or model number")

        for key in FACT_KEYS:
            fact = product.get(key)
            if fact is None:
                continue
            if not isinstance(fact, dict):
                errors.append(f"{label}.{key}: must be an object or null")
                continue
            has_value = fact.get("value") is not None or fact.get("supportEndDate") is not None
            if has_value:
                _check_source(f"{label}.{key}", fact, errors)

        price = product.get("priceInr") or {}
        if price.get("value") is not None and not isinstance(price["value"], (int, float)):
            errors.append(f"{label}.priceInr: 'value' must be a number")
        start_source = (product.get("updatePolicy") or {}).get("startSource")
        if start_source is not None and not str(start_source).startswith("https://"):
            errors.append(f"{label}.updatePolicy: 'startSource' must be an https:// URL")
        end = (product.get("updatePolicy") or {}).get("supportEndDate")
        if end is not None and (not isinstance(end, str) or not MONTH_PATTERN.match(end)):
            errors.append(f"{label}.updatePolicy: 'supportEndDate' must be YYYY-MM or YYYY-MM-DD")
    return errors


def check_options(options):
    errors = []
    seen = set()
    for index, option in enumerate(options):
        label = option.get("optionId", f"option #{index}")
        for key in ("city", "optionId", "name", "handover"):
            if not isinstance(option.get(key), str) or not option[key].strip():
                errors.append(f"{label}: '{key}' is required")
        if (option.get("city"), label) in seen:
            errors.append(f"{label}: duplicate optionId in city")
        seen.add((option.get("city"), label))
        if option.get("type") not in OPTION_TYPES:
            errors.append(f"{label}: 'type' must be one of {sorted(OPTION_TYPES)}")
        categories = option.get("categories", [])
        if not isinstance(categories, list) or not set(categories) <= CATEGORIES:
            errors.append(f"{label}: 'categories' must be a list drawn from {sorted(CATEGORIES)} (empty means any)")
        if not isinstance(option.get("brands", []), list):
            errors.append(f"{label}: 'brands' must be a list (empty means any brand)")
        if not isinstance(option.get("handoffConfirmed"), bool):
            errors.append(f"{label}: 'handoffConfirmed' must be true or false")
        _check_source(label, option, errors)
    return errors


def check_factors(factors):
    errors = []
    seen = set()
    for index, factor in enumerate(factors):
        label = factor.get("factorId", f"factor #{index}")
        for key in ("factorId", "unit"):
            if not isinstance(factor.get(key), str) or not factor[key].strip():
                errors.append(f"{label}: '{key}' is required")
        if label in seen:
            errors.append(f"{label}: duplicate factorId")
        seen.add(label)
        value = factor.get("kgCo2ePerUnit")
        if value is None:
            continue
        if not isinstance(value, (int, float)) or value <= 0:
            errors.append(f"{label}: 'kgCo2ePerUnit' must be a positive number or null")
        _check_source(label, factor, errors)
    return errors


def check_support_periods(rows):
    errors = []
    for index, row in enumerate(rows):
        label = row.get("model", f"support row #{index}")
        for key in ("brand", "model"):
            if not isinstance(row.get(key), str) or not row[key].strip():
                errors.append(f"{label}: '{key}' is required")
        if row.get("category") not in CATEGORIES:
            errors.append(f"{label}: 'category' must be one of {sorted(CATEGORIES)}")
        if not _valid_date(row.get("supportEndDate")):
            errors.append(f"{label}: 'supportEndDate' must be a real date in YYYY-MM-DD form")
        _check_source(label, row, errors)
    return errors


def check_all():
    from support_catalog import full_catalog

    support = load("support_periods.json") if (DATA_DIR / "support_periods.json").exists() else []
    return (
        check_products(full_catalog(load("products.json")))
        + check_support_periods(support)
        + check_options(load("options.json"))
        + check_factors(load("factors.json"))
    )


def load(name):
    with open(DATA_DIR / name, encoding="utf-8") as file:
        return json.load(file)


def main():
    errors = check_all()
    for error in errors:
        print(f"ERROR {error}")
    if errors:
        sys.exit(1)
    print("Data is valid.")


if __name__ == "__main__":
    main()
