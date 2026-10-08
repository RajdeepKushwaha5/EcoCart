"""Where a device sits among comparable devices in the catalog, for the card's scorecard bars.

Bars only compare like with like: support dates within the same kind of device, and reported footprints within
the same maker and kind of device, because makers measure lifecycle carbon in different ways.
"""

from carbon import carbon_block
from categories import device_category
from facts import month_label, support_end

MIN_PEERS = 3


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
    row = {"value": month_label(end), "position": None, "low": None, "high": None, "count": len(ends)}
    if len(ends) >= MIN_PEERS:
        ordinals = [item.toordinal() for item in ends]
        row.update(position=_position(end.toordinal(), ordinals), low=month_label(min(ends)), high=month_label(max(ends)))
    return row


def footprint_row(product, catalog):
    carbon = carbon_block(product, [])
    if carbon is None:
        return None
    category = device_category(product)
    peers = [
        carbon_block(item, [])["kg"] for item in catalog
        if item["brand"] == product["brand"] and device_category(item) == category and carbon_block(item, []) is not None
    ]
    row = {"value": carbon["kg"], "position": None, "low": None, "high": None, "count": len(peers), "brand": product["brand"]}
    if len(peers) >= MIN_PEERS:
        row.update(position=_position(carbon["kg"], peers), low=min(peers), high=max(peers))
    return row


def scorecard(product, catalog):
    return {"support": support_row(product, catalog), "footprint": footprint_row(product, catalog)}
