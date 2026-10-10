import pytest

import estimate
from estimate import ALLOWED, SECTORS, choose_sector, sector_from_crumbs

TSHIRT = ["Clothing & Accessories", "Men", "T-shirts & Polos", "T-shirts"]


def test_most_specific_crumb_decides():
    sector, label, crumb = sector_from_crumbs(["Home & Kitchen", "Kitchen & Dining", "Cookware", "Pressure Cookers"], "Pigeon cooker")
    assert (sector, crumb) == ("332200", "Pressure Cookers")


def test_falls_back_to_a_broader_crumb():
    sector, _, crumb = sector_from_crumbs(["Clothing & Accessories", "Men", "Something New"], "Shirt")
    assert (sector, crumb) == ("315000", "Clothing & Accessories")


def test_and_is_read_as_ampersand():
    assert sector_from_crumbs(["Clothing and Accessories"], "Shirt")[0] == "315000"


def test_title_picks_the_material_for_bottles():
    crumbs = ["Home & Kitchen", "Water Bottles"]
    assert sector_from_crumbs(crumbs, "Milton Steel Bottle 1L")[0] == "332999"
    assert sector_from_crumbs(crumbs, "Cello Plastic Fridge Bottle")[0] == "326160"
    assert sector_from_crumbs(crumbs, "Borosilicate Glass Bottle")[0] == "327200"


def test_digital_and_renewed_items_get_no_estimate():
    result = estimate.estimate(["Kindle Store", "Kindle eBooks"], "A novel", 199)
    assert result == {"estimate": None, "reason": "excluded"}


def test_unknown_breadcrumb_without_a_model_gets_nothing(monkeypatch):
    monkeypatch.delenv("BEDROCK_MODEL_ID", raising=False)
    assert estimate.estimate(["Something Unheard Of"], "Widget", 500) == {"estimate": None, "reason": "unclassified"}


def test_no_price_means_no_number():
    result = estimate.estimate(TSHIRT, "Cotton T-shirt", None)
    assert result == {"estimate": None, "reason": "no-price", "category": "Clothing"}


def test_number_is_price_times_dataset_factor():
    result = estimate.estimate(TSHIRT, "Cotton T-shirt", 1000)["estimate"]
    expected = 1000 * SECTORS["315000"]["kgPerInr"]
    assert result["kind"] == "category-estimate"
    assert result["kg"] == pytest.approx(expected, rel=0.05)
    assert result["classifiedBy"] == "breadcrumb"
    assert result["dataset"]["attribution"] == "CEDA by Watershed"


def test_model_answer_must_come_from_the_list(monkeypatch):
    monkeypatch.setenv("BEDROCK_MODEL_ID", "test-model")
    estimate._cached_model_sector.cache_clear()
    monkeypatch.setattr(estimate, "_model_sector", lambda *_: "999999")
    assert choose_sector(["Mystery"], "Odd thing") == (None, None, "none", None)

    estimate._cached_model_sector.cache_clear()
    monkeypatch.setattr(estimate, "_model_sector", lambda *_: "315000")
    assert choose_sector(["Mystery"], "Odd shirt") == ("315000", ALLOWED["315000"], "model", None)


def test_model_failure_is_not_fatal(monkeypatch):
    monkeypatch.setenv("BEDROCK_MODEL_ID", "test-model")
    estimate._cached_model_sector.cache_clear()

    def broken(*_):
        raise RuntimeError("access denied")

    monkeypatch.setattr(estimate, "_model_sector", broken)
    assert choose_sector(["Mystery 2"], "Thing") == (None, None, "none", None)


def test_every_rule_points_at_a_built_sector():
    for code in ALLOWED:
        assert code in SECTORS


def test_singular_and_plural_both_match():
    assert sector_from_crumbs(["T-Shirt"], "Shirt")[0] == "315000"
    assert sector_from_crumbs(["Beard Trimmer"], "Philips trimmer")[0] == "335210"


def test_title_is_the_last_resort_and_the_longest_phrase_wins(monkeypatch):
    monkeypatch.delenv("BEDROCK_MODEL_ID", raising=False)
    sector, _, how, matched = choose_sector([], "Mamaearth Tea Tree Face Wash 100 ml")
    assert (sector, how, matched) == ("325620", "title", "face wash")
    assert choose_sector([], "Men's Cotton Polo T-Shirt")[0] == "315000"


def test_vague_title_words_are_not_enough(monkeypatch):
    monkeypatch.delenv("BEDROCK_MODEL_ID", raising=False)
    assert choose_sector([], "Premium Home Collection for Men") == (None, None, "none", None)


def test_flipkart_style_crumbs():
    assert sector_from_crumbs(["Food Products", "Tea Powder", "Tata Tea Premium Tea Powder"], "Tata Tea")[0] == "311920"
    assert sector_from_crumbs(["Home & Kitchen", "Kitchen Storage & Containers", "Jars"], "Borosilicate Glass Jar Set")[0] == "327200"
    assert sector_from_crumbs(["Car & Motorbike", "Car & Motorbike Care", "Wash Equipment", "Shampoos"], "3M Car Wash Shampoo")[0] == "325610"
    # Outside that department, shampoo is still hair care.
    assert sector_from_crumbs(["Beauty", "Hair Care", "Shampoos"], "Dove Shampoo")[0] == "325620"
    assert sector_from_crumbs(["Home & Kitchen", "Home & Decor", "Home Fragrance", "Incense Sticks"], "Agarbatti")[0] == "339990"


def test_per_rupee_chart_shows_the_category_beside_everyday_ones():
    rank = estimate.per_rupee_rank("315000")
    labels = [item["label"] for item in rank["examples"]]
    values = [item["kgPerThousandInr"] for item in rank["examples"]]
    assert values == sorted(values)
    assert [item["current"] for item in rank["examples"]].count(True) == 1
    assert "Clothing" in labels and len(labels) == len(set(labels))
    assert 1 <= rank["rank"] <= rank["count"]
