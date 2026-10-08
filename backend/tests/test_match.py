from match import match_listing

CATALOG = [
    {"modelId": "a55", "displayName": "Galaxy A55 5G", "aliases": ["Galaxy A55"], "modelNumbers": ["SM-A556E"]},
    {"modelId": "a5", "displayName": "Galaxy A5", "aliases": ["Galaxy A5"], "modelNumbers": []},
    {"modelId": "ip15", "displayName": "iPhone 15", "aliases": ["iPhone 15"], "excludes": ["Pro", "Plus"]},
    {"modelId": "ip15pro", "displayName": "iPhone 15 Pro", "aliases": ["iPhone 15 Pro"]},
]


def test_exact_model_number_in_details():
    result = match_listing("Some phone", {"Item model number": "SM-A556EZKAINS"}, CATALOG)
    assert result == {"modelId": "a55", "matchType": "exact", "candidates": []}


def test_alias_is_whole_word_only():
    result = match_listing("Samsung Galaxy A55 5G (Navy, 8GB)", {}, CATALOG)
    assert result["modelId"] == "a55"
    assert result["matchType"] == "alias"


def test_longest_alias_wins():
    assert match_listing("Apple iPhone 15 Pro (128 GB)", {}, CATALOG)["modelId"] == "ip15pro"


def test_excludes_block_a_shorter_alias():
    result = match_listing("Apple iPhone 15 Plus (128 GB)", {}, CATALOG)
    assert result == {"modelId": None, "matchType": "none", "candidates": []}


def test_ambiguous_when_two_products_tie():
    catalog = CATALOG + [{"modelId": "dup", "displayName": "Dup", "aliases": ["Galaxy A55"]}]
    result = match_listing("Galaxy A55", {}, catalog)
    assert result["matchType"] == "ambiguous"
    assert {c["modelId"] for c in result["candidates"]} == {"a55", "dup"}


def test_short_identifier_needs_exact_value():
    catalog = [{"modelId": "x", "displayName": "X", "aliases": [], "modelNumbers": ["A12"]}]
    assert match_listing("Phone", {"Model": "A125"}, catalog)["matchType"] == "none"
    assert match_listing("Phone", {"Model": "A12"}, catalog)["matchType"] == "exact"


def test_alias_parts_can_appear_in_any_order():
    catalog = [
        {"modelId": "mba13", "displayName": "MBA 13", "aliases": ["MacBook Air + M4 + 13"]},
        {"modelId": "mba15", "displayName": "MBA 15", "aliases": ["MacBook Air + M4 + 15"]},
    ]
    assert match_listing("Apple 2025 MacBook Air 13″ laptop with M4 chip", {}, catalog)["modelId"] == "mba13"
    assert match_listing("Apple MacBook Air M4 (16 GB/256 GB SSD)", {}, catalog)["matchType"] == "none"


def test_plus_sign_is_kept_as_a_word():
    catalog = [{"modelId": "s25", "displayName": "S25", "aliases": ["Galaxy S25"], "excludes": ["Plus", "Ultra"]}]
    assert match_listing("Samsung Galaxy S25 5G", {}, catalog)["modelId"] == "s25"
    assert match_listing("Samsung Galaxy S25+ 5G", {}, catalog)["matchType"] == "none"


def test_part_number_inside_the_title():
    catalog = [{"modelId": "mba13", "displayName": "MBA 13", "aliases": [], "modelNumbers": ["MW123"]}]
    result = match_listing("Apple MacBook Air M4 (16 GB/256 GB SSD/macOS) MW123HN/A", {}, catalog)
    assert result == {"modelId": "mba13", "matchType": "exact", "candidates": []}
