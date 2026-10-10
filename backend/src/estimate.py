"""Category estimates for products without published data.

The number always comes from Open CEDA's average emissions per rupee for the product's sector in India,
multiplied by the price on the page. Only the choice of sector can come from a model, and only when the
breadcrumb matches no rule; the model must pick a sector from the fixed list, and anything else is rejected.
"""

import json
import logging
import os
import re
from functools import lru_cache
from pathlib import Path

from carbon import round_significant

logger = logging.getLogger(__name__)

DATA = json.loads((Path(__file__).parent / "estimates.json").read_text(encoding="utf-8"))
DATASET = DATA["dataset"]
SECTORS = DATA["sectors"]

MAX_PRICE_INR = 10_000_000

CLASSIFY_PROMPT = (
    "You sort products from an Indian shopping site into one sector from a fixed list. "
    "Reply with JSON only: {\"sector\": \"<code from the list>\"}, or {\"sector\": null} if none fits "
    "or the item is digital, a gift card, a service, used or refurbished. Never invent a code."
)


def normalize(text):
    return " ".join(str(text).lower().replace(" and ", " & ").split())


def _build_index(rules):
    index = {}
    for rule in rules:
        for term in rule["crumbs"]:
            index[term] = rule
    return index


# Rules with "under" apply only inside those departments ("Shampoos" under "Car & Motorbike" is a car cleaner).
SCOPED = [(set(rule["under"]), _build_index([rule])) for rule in DATA["rules"] if rule.get("under")]
CRUMB_INDEX = _build_index([rule for rule in DATA["rules"] if not rule.get("under")])

# Broad words that name a department rather than a product. They are fine in a breadcrumb but too vague in a title.
TITLE_SKIP = {
    "men", "women", "home", "food", "beauty", "baby", "grocery", "decor", "lighting", "storage", "games", "sports",
    "fitness", "electrical", "electricals", "paper", "mats", "oils", "drinks", "beverages", "gardening", "plants",
    "furniture", "toys", "clothing", "shoes", "jewellery", "jewelry", "watches", "books", "staples", "snacks", "tea",
    "coffee", "milk", "salt", "seeds", "nuts", "bags", "bins", "bowls", "plates", "glasses", "mugs", "runners", "home & kitchen",
    "kitchen & dining", "fiction", "reference", "religion", "academic", "comics", "software", "services", "audible",
}


def _variants(term):
    """Singular and plural forms, so "T-Shirt" matches "t-shirts" and "Beard Trimmer" matches "trimmers"."""
    forms = {term, term + "s", term + "es"}
    if term.endswith("es"):
        forms.add(term[:-2])
    if term.endswith("s"):
        forms.add(term[:-1])
    return forms


def _rule_for(crumb, departments=frozenset()):
    """The whole crumb, then its last two words, then its last word, which usually names the product:
    "Tata Tea Premium Tea Powder" is tea powder, and "Beard Trimmer" is a trimmer."""
    phrase = normalize(crumb)
    words = phrase.split(" ")
    candidates = [phrase]
    if len(words) > 2:
        candidates.append(" ".join(words[-2:]))
    if len(words) > 1 and words[-1] not in TITLE_SKIP:
        candidates.append(words[-1])
    indexes = [index for under, index in SCOPED if under & departments] + [CRUMB_INDEX]
    for index in indexes:
        for candidate in candidates:
            for form in _variants(candidate):
                if form in index:
                    return index[form]
    return None


# Every title-safe term in every singular and plural form, longest first, so the most specific phrase wins.
TITLE_TERMS = sorted(
    {(form, term) for term in CRUMB_INDEX if term not in TITLE_SKIP and CRUMB_INDEX[term]["sector"] for form in _variants(term)},
    key=lambda pair: -len(pair[0]),
)
# Allowed answers for the model: every sector the rules use, with the label people see.
ALLOWED = {}
for _rule in DATA["rules"]:
    for _target in [_rule] + _rule.get("byTitle", []):
        if _target["sector"]:
            ALLOWED.setdefault(_target["sector"], _target["label"])


def _title_has(title, words):
    lowered = normalize(title)
    return any(re.search(rf"\b{re.escape(word)}\b", lowered) for word in words)


def _apply(rule, title, matched):
    for override in rule.get("byTitle", []):
        if _title_has(title, override["words"]):
            return override["sector"], override["label"], matched
    return rule["sector"], rule["label"], matched


def sector_from_crumbs(crumbs, title):
    """Return (sector, label, matched crumb) from the most specific crumb that matches a rule, or None."""
    departments = frozenset(normalize(crumb) for crumb in crumbs)
    for crumb in reversed(crumbs):
        rule = _rule_for(crumb, departments)
        if rule is not None:
            return _apply(rule, title, crumb)
    return None


def sector_from_title(title):
    """Last resort: the longest product phrase from the rules that appears in the title."""
    lowered = normalize(title)
    for form, term in TITLE_TERMS:
        if re.search(rf"(?<![\w-]){re.escape(form)}(?![\w-])", lowered):
            return _apply(CRUMB_INDEX[term], title, form)
    return None


def _model_sector(model_id, crumbs, title):
    import boto3

    choices = "\n".join(f"{code}: {label}" for code, label in sorted(ALLOWED.items()))
    product = json.dumps({"title": title, "breadcrumb": crumbs})
    response = boto3.client("bedrock-runtime").converse(
        modelId=model_id,
        system=[{"text": CLASSIFY_PROMPT}],
        messages=[{"role": "user", "content": [{"text": f"Sectors:\n{choices}\n\nProduct:\n{product}"}]}],
        inferenceConfig={"maxTokens": 40, "temperature": 0},
    )
    raw = response["output"]["message"]["content"][0]["text"].strip()
    raw = raw.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    return json.loads(raw).get("sector")


@lru_cache(maxsize=2048)
def _cached_model_sector(model_id, crumbs, title):
    try:
        sector = _model_sector(model_id, list(crumbs), title)
    except Exception:
        logger.exception("Sector classification failed")
        return None
    if sector is not None and sector not in ALLOWED:
        logger.warning("Model answered a sector outside the list: %s", sector)
        return None
    return sector


def choose_sector(crumbs, title):
    """Return (sector or None, label, how, matched) where how is 'breadcrumb', 'title', 'model' or 'none'."""
    found = sector_from_crumbs(crumbs, title)
    if found is not None:
        sector, label, matched = found
        return sector, label, "breadcrumb", matched
    model_id = os.environ.get("BEDROCK_MODEL_ID", "")
    if model_id:
        sector = _cached_model_sector(model_id, tuple(crumbs), title)
        if sector:
            return sector, ALLOWED[sector], "model", None
    found = sector_from_title(title)
    if found is not None:
        sector, label, matched = found
        return sector, label, "title", matched
    return None, None, "none", None


# Everyday categories shown beside the product's own in the card's per-rupee chart.
REFERENCE_SECTORS = ["315000", "1111B0", "311920", "511130", "335210"]
# The shopper-facing name of each sector: the label of the first rule that uses it.
SECTOR_LABELS = {}
for _rule in DATA["rules"]:
    if _rule.get("sector"):
        SECTOR_LABELS.setdefault(_rule["sector"], _rule["label"])


def per_rupee_rank(sector):
    """Where this category sits, per rupee spent, among every category EcoCart can estimate."""
    values = sorted(item["kgPerInr"] for item in SECTORS.values())
    mine = SECTORS[sector]["kgPerInr"]
    ordered = sorted(SECTORS, key=lambda code: SECTORS[code]["kgPerInr"])
    codes = [ordered[0], ordered[-1], sector] + [code for code in REFERENCE_SECTORS if code in SECTORS]
    examples = [
        {"label": SECTOR_LABELS.get(code, SECTORS[code]["name"]),
         "kgPerThousandInr": round_significant(SECTORS[code]["kgPerInr"] * 1000), "current": code == sector}
        for code in sorted(dict.fromkeys(codes), key=lambda code: SECTORS[code]["kgPerInr"])
    ]
    return {
        "position": round(sum(value < mine for value in values) / (len(values) - 1), 2),
        "lowest": round_significant(values[0] * 1000),
        "highest": round_significant(values[-1] * 1000),
        "count": len(values),
        "rank": sum(value < mine for value in values) + 1,
        "examples": examples,
    }


def estimate(crumbs, title, price):
    """A labelled category estimate, or a reason why there is none."""
    sector, label, how, matched = choose_sector(crumbs, title)
    if sector is None:
        reason = "excluded" if how == "breadcrumb" else "unclassified"
        return {"estimate": None, "reason": reason}
    if price is None or not 0 < price <= MAX_PRICE_INR:
        return {"estimate": None, "reason": "no-price", "category": label}

    factor = SECTORS[sector]
    return {
        "estimate": {
            "kind": "category-estimate",
            "kg": round_significant(price * factor["kgPerInr"]),
            "priceInr": price,
            "category": label,
            "sector": {"code": sector, "name": factor["name"]},
            "kgPerThousandInr": round_significant(factor["kgPerInr"] * 1000),
            "perRupee": per_rupee_rank(sector),
            "classifiedBy": how,
            "matched": matched,
            "dataset": {key: DATASET[key] for key in ("name", "attribution", "licence", "source", "baseYear", "priceYear")},
        },
    }
