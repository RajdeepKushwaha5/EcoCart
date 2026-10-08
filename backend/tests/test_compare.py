from datetime import date

from compare import NO_CURRENT_END_DATE, NO_PAGE_PRICE, NO_QUALIFYING_PHONE, find_alternative

TODAY = date(2026, 10, 9)
SRC = "https://example.com"


def phone(model_id, end=None, price=None, checked="2026-10-08"):
    return {
        "modelId": model_id,
        "displayName": model_id.upper(),
        "updatePolicy": None if end is None else {"value": "x", "supportEndDate": end, "source": SRC, "checked": "2026-10-01"},
        "priceInr": None if price is None else {"value": price, "source": SRC, "checked": checked},
    }


def test_needs_page_price():
    assert find_alternative(phone("a", "2029-01"), None, [], TODAY) == (None, NO_PAGE_PRICE)


def test_needs_current_end_date():
    assert find_alternative(phone("a"), 30000, [], TODAY) == (None, NO_CURRENT_END_DATE)


def test_picks_latest_support_within_price_band():
    current = phone("a", "2029-01")
    catalog = [
        current,
        phone("b", "2030-06", 32000),
        phone("c", "2031-01", 35000),
        phone("d", "2032-01", 40000),
    ]
    alternative, reason = find_alternative(current, 30000, catalog, TODAY)
    assert reason is None
    assert alternative["modelId"] == "c"
    assert alternative["reason"] == "Security updates until at least January 2031, compared with January 2029 for this phone."


def test_ignores_stale_or_unsourced_prices():
    current = phone("a", "2029-01")
    stale = phone("b", "2031-01", 30000, checked="2026-09-30")
    unsourced = phone("c", "2031-01", 30000)
    unsourced["priceInr"]["source"] = None
    assert find_alternative(current, 30000, [current, stale, unsourced], TODAY) == (None, NO_QUALIFYING_PHONE)


def test_ignores_phones_without_later_support():
    current = phone("a", "2030-01")
    catalog = [current, phone("b", "2030-01", 30000), phone("c", "2029-01", 30000)]
    assert find_alternative(current, 30000, catalog, TODAY) == (None, NO_QUALIFYING_PHONE)


def test_alternatives_stay_in_the_same_category():
    current = phone("a", "2029-01")
    laptop = {**phone("mac", "2032-01", 30000), "category": "laptop"}
    assert find_alternative(current, 30000, [current, laptop], TODAY) == (None, NO_QUALIFYING_PHONE)
