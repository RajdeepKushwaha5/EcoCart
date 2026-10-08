from validate_data import check_all, check_factors, check_options, check_products

SRC = "https://example.com"


def test_repository_data_is_valid():
    assert check_all() == []


def test_factor_with_value_needs_source():
    factor = {"factorId": "f", "unit": "km", "kgCo2ePerUnit": 0.2, "source": None, "checked": None}
    assert any("source" in e for e in check_factors([factor]))
    assert check_factors([{**factor, "kgCo2ePerUnit": None}]) == []
    assert any("positive" in e for e in check_factors([{**factor, "kgCo2ePerUnit": -1}]))


def test_fact_with_value_needs_source_and_date():
    product = {
        "modelId": "x", "brand": "B", "displayName": "X", "aliases": ["X"],
        "lifecycleCo2eKg": {"value": 50, "source": None, "checked": "2026-13-01"},
    }
    errors = check_products([product])
    assert any("source" in e for e in errors)
    assert any("checked" in e for e in errors)


def test_option_needs_type_source_and_handoff_flag():
    option = {"city": "delhi-ncr", "optionId": "o", "name": "N", "handover": "Drop-off", "type": "sell"}
    errors = check_options([option])
    assert any("type" in e for e in errors)
    assert any("source" in e for e in errors)
    assert any("handoffConfirmed" in e for e in errors)


def test_valid_option_passes():
    option = {
        "city": "delhi-ncr", "optionId": "o", "name": "N", "type": "recycle", "brands": [],
        "handover": "Drop-off", "handoffConfirmed": True, "source": SRC, "checked": "2026-10-01",
    }
    assert check_options([option]) == []


def test_support_list_rows_need_a_source_and_a_real_end_date():
    from validate_data import check_support_periods

    row = {"brand": "POCO", "model": "POCO X7", "category": "phone", "supportEndDate": "2031-01-09",
           "source": SRC, "checked": "2026-10-02"}
    assert check_support_periods([row]) == []
    assert any("supportEndDate" in e for e in check_support_periods([{**row, "supportEndDate": "2031-13-01"}]))
    assert any("source" in e for e in check_support_periods([{**row, "source": None}]))


def test_support_list_entries_never_replace_curated_devices():
    from support_catalog import catalog_entries

    curated = [{"modelId": "oneplus-13", "displayName": "OnePlus 13", "aliases": ["OnePlus 13"]}]
    rows = [
        {"brand": "OnePlus", "model": "OnePlus 13", "category": "phone", "supportEndDate": "2031-01-07", "source": SRC, "checked": "2026-10-02"},
        {"brand": "POCO", "model": "POCO X7 Pro", "category": "phone", "supportEndDate": "2031-01-09", "source": SRC, "checked": "2026-10-02"},
        {"brand": "Redmi", "model": "REDMI Note 15 Pro+ 5G", "category": "phone", "supportEndDate": "2032-01-01", "source": SRC, "checked": "2026-10-02"},
    ]
    entries = catalog_entries(rows, curated)
    assert [e["modelId"] for e in entries] == ["poco-x7-pro", "redmi-note-15-pro-plus-5g"]
    assert entries[1]["aliases"] == ["REDMI Note 15 Pro Plus 5G"]
    assert "POCO X7 Pro Max" in entries[0]["excludes"] and "POCO X7 Pro Pro" not in entries[0]["excludes"]


def test_generated_entries_tell_close_models_apart():
    from match import match_listing
    from support_catalog import catalog_entries

    rows = [{"brand": "POCO", "model": name, "category": "phone", "supportEndDate": "2031-01-09", "source": SRC, "checked": "2026-10-02"}
            for name in ("POCO X7", "POCO X7 Pro")]
    catalog = catalog_entries(rows, [])
    assert match_listing("POCO X7 Pro 5G (Black, 256 GB)", {}, catalog)["modelId"] == "poco-x7-pro"
    assert match_listing("POCO X7 5G with Pro-grade camera", {}, catalog)["modelId"] == "poco-x7"
    assert match_listing("POCO X7 Neo 5G", {}, catalog)["modelId"] is None
