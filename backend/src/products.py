"""Build the product card payload. Facts without a source and checked date are returned as null."""

from carbon import carbon_block
from categories import device_category
from compare import find_alternative, find_lower_footprint
from explain import summarize
from facts import MONTHS, is_sourced, month_label, support_end
from scorecard import scorecard

FACT_KEYS = ["updatePolicy", "repairability", "lifecycleCo2eKg", "takeBack"]


def public_product(product):
    view = {
        "modelId": product["modelId"],
        "brand": product["brand"],
        "displayName": product["displayName"],
        "category": device_category(product),
    }
    for key in FACT_KEYS:
        fact = product.get(key)
        view[key] = fact if is_sourced(fact) else None
    return view


def headline(product):
    policy = product.get("updatePolicy")
    end = support_end(product)
    if end is not None:
        return {
            "label": "Security updates until at least",
            "value": month_label(end),
            "source": policy["source"],
            # True when the date is the promised period added to an official start date.
            "derived": bool(policy.get("derived")),
            "startSource": policy.get("startSource"),
        }
    if is_sourced(policy) and policy.get("value"):
        return {"label": "Update period", "value": policy["value"], "source": policy["source"]}
    return {"label": "Update support", "value": "Unknown", "source": None}


def badge(product):
    """Short label for search results. None when there is nothing sourced to show."""
    end = support_end(product)
    if end is not None:
        return f"Updates till at least {MONTHS[end.month - 1][:3]} {end.year}"
    if carbon_block(product, []) is not None:
        return "CO₂e published"
    return None


def catalog_entry(product):
    """What the search page needs to match titles in the browser and label results."""
    return {
        "modelId": product["modelId"],
        "displayName": product["displayName"],
        "category": device_category(product),
        "aliases": product.get("aliases", []),
        "excludes": product.get("excludes", []),
        "badge": badge(product),
    }


def product_card(product, page_price, catalog, factors, today):
    alternative, alternative_reason = find_alternative(product, page_price, catalog, today)
    brands = sorted({item["brand"] for item in catalog})
    carbon = carbon_block(product, factors)
    explanation, explanation_source = summarize(product, alternative, brands, carbon)
    return {
        "product": public_product(product),
        "headline": headline(product),
        "carbon": carbon,
        "alternative": alternative,
        "alternativeReason": alternative_reason,
        "lowerFootprint": find_lower_footprint(product, page_price, catalog, today),
        "scorecard": scorecard(product, catalog),
        "explanation": explanation,
        "explanationSource": explanation_source,
    }
