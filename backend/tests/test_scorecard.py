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


def test_footprint_chart_excludes_other_storage_and_regional_bases():
    products = [phone(str(index), "Apple", kg=50 + index) for index in range(4)]
    for item, basis in zip(products, ["128GB model", "128GB model", "256GB model", "EU model"]):
        item["lifecycleCo2eKg"]["basis"] = basis
    row = scorecard(products[0], products)["footprint"]
    assert row["count"] == 2
    assert row["position"] is None


def test_storage_comparison_does_not_ignore_hardware_or_connectivity():
    assert not comparable({"basis": "M5, 8-core GPU, 16GB, 512GB"}, {"basis": "M5, 10-core GPU, 16GB, 512GB"})
    assert not comparable({"basis": "128GB Wi-Fi + Cellular"}, {"basis": "256GB model"})


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


def test_charts_compare_the_same_maker_and_count_support_years():
    catalog = [
        {"modelId": f"p{i}", "brand": "Apple", "displayName": f"Phone {i}", "category": "phone",
         "lifecycleCo2eKg": {"value": 50 + i, "source": "https://example.com", "checked": "2026-10-01"},
         "updatePolicy": {"supportEndDate": f"{2029 + i % 2}-09", "source": "https://example.com", "checked": "2026-10-01"}}
        for i in range(4)
    ] + [{"modelId": "other", "brand": "Samsung", "displayName": "Other", "category": "phone",
          "lifecycleCo2eKg": {"value": 10, "source": "https://example.com", "checked": "2026-10-01"}}]
    card = scorecard(catalog[2], catalog)
    footprint = card["footprint"]
    assert [device["modelId"] for device in footprint["devices"]] == ["p0", "p1", "p2", "p3"]
    assert [device["current"] for device in footprint["devices"]] == [False, False, True, False]
    assert footprint["rank"] == 3
    assert card["support"]["years"] == [{"year": 2029, "count": 2, "current": True}, {"year": 2030, "count": 2, "current": False}]
