"""Read official Indian store prices. Used by the daily refresh function and by scripts/refresh_prices.py.

A price that cannot be read is reported, never guessed.
"""

import json
import re
from urllib.request import Request, urlopen

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129 Safari/537.36"

# modelId -> official store page for India.
STORE_PAGES = {
    "apple-iphone-16": "https://www.apple.com/in/shop/buy-iphone/iphone-16",
    "apple-iphone-17": "https://www.apple.com/in/shop/buy-iphone/iphone-17",
    "apple-iphone-17e": "https://www.apple.com/in/shop/buy-iphone/iphone-17e",
    # The 18 Pro page also sells the Pro Max; its lowest price is the 18 Pro's.
    "apple-iphone-18-pro": "https://www.apple.com/in/shop/buy-iphone/iphone-18-pro",
    "apple-iphone-air": "https://www.apple.com/in/shop/buy-iphone/iphone-air",
    "google-pixel-9a": "https://store.google.com/in/product/pixel_9a?hl=en-GB",
    "google-pixel-10": "https://store.google.com/in/product/pixel_10?hl=en-GB",
    "google-pixel-10a": "https://store.google.com/in/product/pixel_10a?hl=en-GB",
}


def fetch(url):
    request = Request(url, headers={"User-Agent": USER_AGENT})
    with urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8", "ignore")


def apple_price(page):
    """Lowest price from the Product JSON-LD block on an Apple Store buy page."""
    for block in re.findall(r'<script type="application/ld\+json">(.*?)</script>', page, re.S):
        data = json.loads(block)
        if data.get("@type") == "Product":
            return data["offers"][0].get("lowPrice")
    return None


def google_price(page):
    """Current price. The Google Store shows "... EMI ... or ₹X", then any struck-out price."""
    found = re.search(r"EMI(?:(?!₹).){0,120}?\bor\s*(?:<[^>]+>\s*)*₹([0-9,]+)", page, re.S)
    return int(found.group(1).replace(",", "")) if found else None


def read_price(url):
    page = fetch(url)
    price = apple_price(page) if "apple.com" in url else google_price(page)
    return int(price) if price else None


def refresh(products, today):
    """Return (updates, failures): updates maps modelId to a new sourced price, failures maps modelId to the reason."""
    updates, failures = {}, {}
    for product in products:
        url = STORE_PAGES.get(product["modelId"])
        if not url:
            continue
        try:
            price = read_price(url)
        except Exception as error:
            failures[product["modelId"]] = str(error)
            continue
        if price is None:
            failures[product["modelId"]] = "price not found on page"
        else:
            updates[product["modelId"]] = {"value": price, "source": url, "checked": today}
    return updates, failures
