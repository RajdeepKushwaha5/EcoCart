"""Makers' official per-model security update lists, and how they become catalog entries.

Used by the weekly support-list job on AWS and by scripts/import_support_periods.py.

Sources, each published by the maker itself:
  Xiaomi, Redmi, POCO  Product Software Support Information (JSON feed behind the page)
  realme               UK PSTI product security update period table
  OnePlus              UK PSTI table, built in the browser, so it is read from a saved copy of the page text
"""

import html
import json
import re
import urllib.request
from datetime import date, datetime

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129 Safari/537.36"

XIAOMI_FEED = "https://trust.mi.com/bff/psti/phone/online"
XIAOMI_PAGE = "https://trust.mi.com/misrc/updates/detail?tab=phone"
REALME_PAGE = "https://www.realme.com/uk/legal/psti"
ONEPLUS_PAGE = "https://www.oneplus.com/uk/psti"

# Region tags some makers add to a model name: "Mi 11 Lite (IN)". India first, then global, then anything else.
REGION = re.compile(r" \((in|global|eea|cn|tw|ru|id|tr|jp)\)$", re.IGNORECASE)
REGION_RANK = {"in": 0, "global": 1}


def request(url, body=None):
    data = None if body is None else json.dumps(body).encode()
    headers = {"User-Agent": USER_AGENT}
    if body is not None:
        headers["Content-Type"] = "application/json"
    with urllib.request.urlopen(urllib.request.Request(url, data=data, headers=headers), timeout=60) as response:
        return response.read().decode("utf-8", errors="replace")


def category_of(name):
    lowered = name.lower()
    if re.search(r"\b(pad|tab)\b", lowered):
        return "tablet"
    if re.search(r"\b(watch|band)\b", lowered):
        return "watch"
    if re.search(r"\bbuds\b", lowered):
        return "earbuds"
    return "phone"


def clean_name(name):
    return " ".join(name.replace(" ", " ").split())


def row(brand, name, end, source, checked):
    return {"brand": brand, "model": clean_name(name), "category": category_of(name),
            "supportEndDate": end, "source": source, "checked": checked}


# ---------- Readers ----------

def xiaomi(checked):
    data = json.loads(request(XIAOMI_FEED, {"page": 1, "pageSize": 1000}))
    rows = []
    for item in data["data"]:
        brand = {"redmi": "Redmi", "poco": "POCO"}.get(item["brand"].lower(), "Xiaomi")
        rows.append(row(brand, item["productName"], item["eolTime"][:10], XIAOMI_PAGE, checked))
    if len(rows) != data["count"]:
        raise ValueError(f"Xiaomi listed {data['count']} models but returned {len(rows)}. Not importing a partial list.")
    return rows


def realme(checked):
    # The table arrives inside a script as an escaped string.
    page = request(REALME_PAGE).replace("\\u003C", "<").replace("\\u003E", ">").replace('\\"', '"')
    rows = []
    for cells in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S | re.I):
        values = [clean_name(html.unescape(re.sub(r"<[^>]+>", " ", cell)))
                  for cell in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", cells, re.S | re.I)]
        if len(values) == 2 and re.fullmatch(r"\d{2}-[A-Za-z]{3}-\d{4}", values[1]):
            name = values[0] if values[0].lower().startswith("realme") else f"realme {values[0]}"
            rows.append(row("realme", name, parse_day(values[1]), REALME_PAGE, checked))
    return rows


def oneplus(text, checked):
    """Rows from the text of the OnePlus page, saved from a browser."""
    lines = [clean_name(line) for line in text.splitlines() if line.strip()]
    rows = []
    for name, end in zip(lines, lines[1:]):
        if name.startswith("OnePlus") and re.fullmatch(r"\d{2}-[A-Za-z]{3}-\d{4}", end):
            rows.append(row("OnePlus", name, parse_day(end), ONEPLUS_PAGE, checked))
    return rows


def parse_day(text):
    return datetime.strptime(text, "%d-%b-%Y").date().isoformat()


# ---------- Tidying ----------

def deduplicate(rows):
    """One row per model. Region variants collapse to one, preferring India, then global, then the earliest date."""
    best = {}
    for item in rows:
        region = REGION.search(item["model"])
        rank = REGION_RANK.get(region.group(1).lower(), 2) if region else 1
        model = REGION.sub("", item["model"])
        key = (item["brand"], model.lower())
        candidate = {**item, "model": model}
        current = best.get(key)
        if current is None or (rank, candidate["supportEndDate"]) < (current[0], current[1]["supportEndDate"]):
            best[key] = (rank, candidate)
    return sorted((item for _, item in best.values()), key=lambda item: (item["brand"], item["model"]))


# ---------- Catalog entries ----------

# Words that turn one model into another: "POCO X8" and "POCO X8 Pro" are different phones.
# They are excluded as whole phrases after the model name, so marketing words elsewhere in a title do no harm.
VARIANT_WORDS = ["Pro", "Plus", "Ultra", "Lite", "Max", "Mini", "SE", "Turbo", "Prime", "Neo", "FE", "Fold", "Flip", "Edge"]


def normalize(text):
    return " ".join(re.sub(r"[^a-z0-9]+", " ", str(text).lower().replace("+", " plus ")).split())


def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", str(text).lower().replace("+", " plus ")).strip("-")


def alias_for(model):
    # In an alias "+" means "all of these parts", so a "Pro+" is written out the way titles are read.
    return model.replace("+", " Plus")


def day_label(value):
    day = date.fromisoformat(value)
    return f"{day.day} {day.strftime('%b')} {day.year}"


def model_id(row):
    # Most names already start with the brand ("POCO X7"); those that do not get it added ("Redmi" for "REDMI 17").
    if normalize(row["model"]).startswith(normalize(row["brand"])):
        return slug(row["model"])
    return f"{slug(row['brand'])}-{slug(row['model'])}"


def entry(row):
    alias = alias_for(row["model"])
    words = set(normalize(alias).split())
    return {
        "modelId": model_id(row),
        "brand": row["brand"],
        "displayName": row["model"],
        "category": row["category"],
        "aliases": [alias],
        "modelNumbers": [],
        "excludes": [f"{alias} {word}" for word in VARIANT_WORDS if word.lower() not in words],
        "priceInr": None,
        "updatePolicy": {
            "value": f"Security updates until {day_label(row['supportEndDate'])}, per {row['brand']}'s official support list.",
            "supportEndDate": row["supportEndDate"],
            "source": row["source"],
            "checked": row["checked"],
        },
        "repairability": None,
        "lifecycleCo2eKg": None,
        "takeBack": None,
        "fromSupportList": True,
    }


def catalog_entries(rows, curated):
    """Entries for listed models that the curated catalog does not already cover."""
    covered = {normalize(alias) for product in curated for alias in product.get("aliases", [])}
    covered |= {normalize(product["displayName"]) for product in curated}
    covered |= {normalize(product["displayName"].split(" ", 1)[-1]) for product in curated}
    taken = {product["modelId"] for product in curated}
    entries = []
    for row in rows:
        item = entry(row)
        if normalize(alias_for(row["model"])) in covered or item["modelId"] in taken:
            continue
        taken.add(item["modelId"])
        entries.append(item)
    return entries
