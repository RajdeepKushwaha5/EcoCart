"""Where a device sits among comparable devices in the catalog, for the card's scorecard bars.

Bars only compare like with like: support dates within the same kind of device, and reported footprints within
the same maker and kind of device, because makers measure lifecycle carbon in different ways.
"""

from carbon import carbon_block
from categories import device_category
from facts import month_label, support_end

MIN_PEERS = 3
# The footprint chart lists the same maker's devices; more than this would not fit on a card.
MAX_CHART_PEERS = 16


def _position(value, values):
    low, high = min(values), max(values)
    if high == low:
        return None
    return round((value - low) / (high - low), 2)


def support_row(product, catalog):
    end = support_end(product)
    if end is None:
        return None
    category = device_category(product)
    ends = [support_end(item) for item in catalog if device_category(item) == category]
    ends = [item for item in ends if item is not None]
    row = {"value": month_label(end), "position": None, "low": None, "high": None, "count": len(ends), "years": []}
    if len(ends) >= MIN_PEERS:
        ordinals = [item.toordinal() for item in ends]
        row.update(position=_position(end.toordinal(), ordinals), low=month_label(min(ends)), high=month_label(max(ends)))
        # How many devices of this kind get updates until each year, for the card's timeline chart.
        counts = {}
        for item in ends:
            counts[item.year] = counts.get(item.year, 0) + 1
        row["years"] = [{"year": year, "count": counts[year], "current": year == end.year} for year in sorted(counts)]
    return row


def footprint_row(product, catalog):
    carbon = carbon_block(product, [])
    if carbon is None:
        return None
    category = device_category(product)
    devices = [
        (item, carbon_block(item, [])) for item in catalog
        if item["brand"] == product["brand"] and device_category(item) == category and carbon_block(item, []) is not None
        and (carbon_block(item, []).get("basis") or None) == (carbon.get("basis") or None)
    ]
    peers = [block["kg"] for _, block in devices]
    row = {"value": carbon["kg"], "position": None, "low": None, "high": None, "count": len(peers), "brand": product["brand"],
           "devices": []}
    if len(peers) >= MIN_PEERS:
        row.update(position=_position(carbon["kg"], peers), low=min(peers), high=max(peers))
        # The same maker's devices with their reported footprints, lowest first, for the card's chart. The device on
        # the page is always included.
        ranked = sorted(devices, key=lambda pair: pair[1]["kg"])
        shown = ranked[:MAX_CHART_PEERS]
        if all(item["modelId"] != product["modelId"] for item, _ in shown):
            shown = ranked[:MAX_CHART_PEERS - 1] + [(product, carbon)]
        row["devices"] = [
            {"modelId": item["modelId"], "name": item["displayName"], "kg": block["kg"], "basis": block.get("basis"),
             "current": item["modelId"] == product["modelId"]}
            for item, block in shown
        ]
        row["rank"] = sum(value < carbon["kg"] for value in peers) + 1
    return row


def scorecard(product, catalog):
    return {"support": support_row(product, catalog), "footprint": footprint_row(product, catalog)}
