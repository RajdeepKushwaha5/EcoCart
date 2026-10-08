"""Weekly job: refresh the catalog from makers' official per-model support lists.

Reads Xiaomi's (with Redmi and POCO) and realme's lists, then adds new models, updates changed dates and removes
models whose support has ended. Devices curated by hand are never touched. If a source cannot be read, its brands'
current entries are kept as they are. OnePlus publishes its list only in the browser, so its entries are kept until
someone imports a fresh copy with scripts/import_support_periods.py.
"""

import logging
from datetime import datetime, timedelta, timezone

import db
from support_lists import catalog_entries, deduplicate, realme, xiaomi

logger = logging.getLogger()
logger.setLevel(logging.INFO)

IST = timezone(timedelta(hours=5, minutes=30))
SOURCES = {"xiaomi": (xiaomi, {"Xiaomi", "Redmi", "POCO"}), "realme": (realme, {"realme"})}


def as_row(item):
    """A stored support-list entry back in the shape the list readers produce."""
    policy = item["updatePolicy"]
    return {"brand": item["brand"], "model": item["displayName"], "category": item["category"],
            "supportEndDate": policy["supportEndDate"], "source": policy["source"], "checked": policy["checked"]}


def handler(event=None, context=None):
    today = datetime.now(IST).date().isoformat()
    table = db.table("PRODUCTS_TABLE")
    items = db.all_products()
    curated = [item for item in items if not item.get("fromSupportList")]
    listed = [item for item in items if item.get("fromSupportList")]

    rows, refreshed = [], set()
    for name, (read, brands) in SOURCES.items():
        try:
            rows += read(today)
            refreshed |= brands
        except Exception:
            logger.exception("Could not read the %s list; keeping its current entries", name)
    rows += [as_row(item) for item in listed if item["brand"] not in refreshed]
    rows = [row for row in deduplicate(rows) if row["supportEndDate"] >= today]

    entries = catalog_entries(rows, curated)
    wanted = {entry["modelId"] for entry in entries}
    removed = [item["modelId"] for item in listed if item["modelId"] not in wanted]
    with table.batch_writer() as batch:
        for entry in entries:
            batch.put_item(Item=entry)
        for model_id in removed:
            batch.delete_item(Key={"modelId": model_id})
    logger.info("Support lists: %s entries, %s removed, sources read: %s", len(entries), len(removed), sorted(refreshed))
    if not refreshed:
        raise RuntimeError("No support list could be read")
    return {"entries": len(entries), "removed": removed, "sourcesRead": sorted(refreshed)}
