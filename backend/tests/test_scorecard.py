from datetime import date

from compare import comparable, find_lower_footprint
from estimate import per_rupee_rank
from scorecard import scorecard

SRC = "https://example.com"
TODAY = date(2026, 10, 2)


def phone(model_id, brand, end=None, kg=None, price=None, category="phone"):
    return {
        "modelId": model_id, "brand": brand, "displayName": model_id, "category": category,
        "updatePolicy": {"value": "x", "supportEndDate": end, "source": SRC, "checked": "2026-10-01"} if end else None,
        "lifecycleCo2eKg": {"value": kg, "source": SRC, "checked": "2026-10-01"} if kg else None,
        "priceInr": {"value": price, "source": SRC, "checked": "2026-10-01"} if price else None,
    }


CATALOG = [
    phone("a", "Apple", "2030-09", 55, 80000),
    phone("b", "Apple", "2031-09", 63, 85000),
    phone("c", "Apple", "2029-09", 70),
    phone("d", "Google", "2033-03", 40, 82000),
    phone("tab", "Apple", "2035-01", 10, category="tablet"),
]


def test_support_bar_compares_the_same_kind_of_device():
    row = scorecard(CATALOG[1], CATALOG)["support"]
    assert row["value"] == "September 2031"
    assert (row["low"], row["high"], row["count"]) == ("September 2029", "March 2033", 4)
    assert 0 < row["position"] < 1


def test_footprint_bar_compares_the_same_maker_only():
    row = scorecard(CATALOG[1], CATALOG)["footprint"]
    assert (row["low"], row["high"], row["count"], row["brand"]) == (55, 70, 3, "Apple")


def test_too_few_peers_means_no_bar():
    row = scorecard(CATALOG[3], CATALOG)["footprint"]
    assert row["position"] is None and row["count"] == 1


def test_lower_footprint_alternative_is_same_maker_and_similar_price():
    alternative = find_lower_footprint(CATALOG[1], 85000, CATALOG, TODAY)
    assert alternative["modelId"] == "a"
    assert "55 kg" in alternative["reason"]
    # Google's 40 kg is lower but measured by a different maker, so it is never suggested.
    assert find_lower_footprint(CATALOG[0], 82000, CATALOG, TODAY) is None


def test_lower_footprint_needs_a_page_price():
    assert find_lower_footprint(CATALOG[1], None, CATALOG, TODAY) is None


def test_per_rupee_rank_is_within_bounds():
    rank = per_rupee_rank("315000")
    assert 0 <= rank["position"] <= 1 and rank["lowest"] < rank["highest"]


def test_footprints_compare_only_on_the_same_footing():
    assert comparable({"basis": "3 years of use"}, {"basis": "3 years of use"})
    assert comparable({"basis": "128GB model"}, {"basis": "256GB model"})
    assert not comparable({"basis": "256GB model"}, {"basis": "128GB model"})
    assert not comparable({"basis": "3 years of use"}, {"basis": "Google estimate, see report"})
    assert not comparable({"basis": None}, {"basis": "256GB model"})
