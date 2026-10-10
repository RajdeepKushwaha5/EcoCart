"""Pick a better-supported alternative only when the evidence allows a fair comparison."""

import re

from carbon import carbon_block
from categories import device_category
from facts import is_sourced, month_label, parse_date, support_end

PRICE_TOLERANCE = 0.20
MAX_PRICE_AGE_DAYS = 7

NO_PAGE_PRICE = "The price on this page could not be read, so no comparison is shown."
NO_CURRENT_END_DATE = "This phone has no published support end date to compare against."
NO_QUALIFYING_PHONE = "No reliable comparison available."


def _fresh_price(product, today):
    price = product.get("priceInr")
    if not is_sourced(price) or not isinstance(price.get("value"), (int, float)):
        return None
    checked = parse_date(price["checked"])
    if checked is None or checked > today or (today - checked).days > MAX_PRICE_AGE_DAYS:
        return None
    return price


def find_alternative(current, page_price, catalog, today):
    """Return (alternative, reason). Exactly one of them is None."""
    if not page_price or page_price <= 0:
        return None, NO_PAGE_PRICE

    current_end = support_end(current)
    if current_end is None:
        return None, NO_CURRENT_END_DATE

    qualifying = []
    category = device_category(current)
    for product in catalog:
        if product["modelId"] == current["modelId"] or device_category(product) != category:
            continue
        price = _fresh_price(product, today)
        end = support_end(product)
        if price is None or end is None or end <= current_end:
            continue
        if abs(price["value"] - page_price) > PRICE_TOLERANCE * page_price:
            continue
        qualifying.append((end, abs(price["value"] - page_price), product, price))

    if not qualifying:
        return None, NO_QUALIFYING_PHONE

    qualifying.sort(key=lambda row: (-row[0].toordinal(), row[1]))
    end, _, product, price = qualifying[0]
    alternative = {
        "modelId": product["modelId"],
        "displayName": product["displayName"],
        "price": {"value": price["value"], "checked": price["checked"], "source": price["source"]},
        "supportEndDate": product["updatePolicy"]["supportEndDate"],
        "supportSource": product["updatePolicy"]["source"],
        "reason": (
            f"Security updates until at least {month_label(end)}, "
            f"compared with {month_label(current_end)} for this phone."
        ),
    }
    return alternative, None


# A reported footprint has to be this much lower before it is worth pointing out.
MIN_FOOTPRINT_GAP = 0.10


STORAGE = re.compile(r"(\d+)\s*(GB|TB)", re.IGNORECASE)


def _storage_gb(basis):
    found = STORAGE.search(basis or "")
    if not found:
        return None
    return int(found.group(1)) * (1024 if found.group(2).upper() == "TB" else 1)


def comparable(current, candidate):
    """Two reported footprints can be compared only on the same footing.

    Either both state the same basis, or both are per storage size and the candidate's size is at least as large,
    so a smaller configuration never looks better just for being smaller.
    """
    if (current.get("basis") or None) == (candidate.get("basis") or None):
        return True
    current_gb, candidate_gb = _storage_gb(current.get("basis")), _storage_gb(candidate.get("basis"))
    return current_gb is not None and candidate_gb is not None and candidate_gb >= current_gb


def _basis(carbon):
    return f" ({carbon['basis']})" if carbon.get("basis") else ""


def find_lower_footprint(current, page_price, catalog, today):
    """A device from the same maker, of the same kind and at a similar price, with a lower reported footprint.

    Only the same maker is compared, because makers measure lifecycle carbon in different ways.
    """
    current_carbon = carbon_block(current, [])
    if not page_price or page_price <= 0 or current_carbon is None:
        return None

    qualifying = []
    category = device_category(current)
    for product in catalog:
        if product["modelId"] == current["modelId"] or product["brand"] != current["brand"]:
            continue
        if device_category(product) != category:
            continue
        carbon = carbon_block(product, [])
        price = _fresh_price(product, today)
        if carbon is None or price is None or carbon["kg"] > current_carbon["kg"] * (1 - MIN_FOOTPRINT_GAP):
            continue
        if not comparable(current_carbon, carbon):
            continue
        if abs(price["value"] - page_price) > PRICE_TOLERANCE * page_price:
            continue
        qualifying.append((carbon["kg"], abs(price["value"] - page_price), product, price, carbon))

    if not qualifying:
        return None
    qualifying.sort(key=lambda row: (row[0], row[1]))
    kg, _, product, price, carbon = qualifying[0]
    return {
        "modelId": product["modelId"],
        "displayName": product["displayName"],
        "price": {"value": price["value"], "checked": price["checked"], "source": price["source"]},
        "kg": kg,
        "basis": carbon.get("basis"),
        "carbonSource": carbon["source"],
        "reason": f"{current['brand']} reports {kg:g} kg CO2e for it{_basis(carbon)}, "
                  f"compared with {current_carbon['kg']:g} kg for this one{_basis(current_carbon)}.",
    }
