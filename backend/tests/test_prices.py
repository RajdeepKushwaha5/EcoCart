import sys
import types

import pytest

import prices

APPLE_PAGE = '<script type="application/ld+json">{"@type": "Product", "offers": [{"lowPrice": 79900}]}</script>'
GOOGLE_PAGE = "<div>Pay monthly with No Cost EMI or <span>₹49,999</span></div><s>₹52,999</s>"


def test_readers():
    assert prices.apple_price(APPLE_PAGE) == 79900
    assert prices.google_price(GOOGLE_PAGE) == 49999
    assert prices.google_price("<p>Out of stock</p>") is None


def test_refresh_reports_failures_and_never_guesses(monkeypatch):
    pages = {"apple-iphone-16": APPLE_PAGE, "google-pixel-9a": "<p>changed layout</p>"}
    monkeypatch.setattr(prices, "fetch", lambda url: next(page for key, page in pages.items() if prices.STORE_PAGES[key] == url))
    products = [{"modelId": "apple-iphone-16"}, {"modelId": "google-pixel-9a"}, {"modelId": "not-sold-online"}]
    updates, failures = prices.refresh(products, "2026-10-02")
    assert updates == {"apple-iphone-16": {"value": 79900, "source": prices.STORE_PAGES["apple-iphone-16"], "checked": "2026-10-02"}}
    assert failures == {"google-pixel-9a": "price not found on page"}


def test_job_writes_updates_then_fails_loudly(monkeypatch):
    written = []
    table = types.SimpleNamespace(update_item=lambda **kwargs: written.append(kwargs))
    monkeypatch.setitem(sys.modules, "db", types.SimpleNamespace(load_catalog=lambda: [], table=lambda name: table))
    sys.modules.pop("price_job", None)
    import price_job

    monkeypatch.setattr(price_job, "refresh", lambda products, today: ({"a": {"value": 100, "source": "s", "checked": today}}, {"b": "down"}))
    with pytest.raises(price_job.PriceRefreshError):
        price_job.handler({}, None)
    assert written[0]["Key"] == {"modelId": "a"}
