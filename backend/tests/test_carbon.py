from carbon import carbon_block, round_significant

SRC = "https://example.com"
PRODUCT = {
    "brand": "Google",
    "lifecycleCo2eKg": {"value": 64, "source": SRC, "checked": "2026-10-01"},
}
FACTORS = [
    {"factorId": "car", "unit": "km in a petrol car", "kgCo2ePerUnit": 0.17, "source": SRC, "checked": "2026-10-01"},
    {"factorId": "grid", "unit": "kWh", "kgCo2ePerUnit": 0.7, "source": SRC, "checked": "2026-10-01"},
    {"factorId": "unsourced", "unit": "x", "kgCo2ePerUnit": 1, "source": None, "checked": None},
    {"factorId": "empty", "unit": "y", "kgCo2ePerUnit": None, "source": SRC, "checked": "2026-10-01"},
]


def test_round_significant():
    assert round_significant(376.47) == 380
    assert round_significant(91.43) == 91
    assert round_significant(0.456) == 0.46


def test_block_uses_only_sourced_factors():
    block = carbon_block(PRODUCT, FACTORS)
    assert block["kg"] == 64
    assert block["reportedBy"] == "Google"
    assert block["equivalents"] == [
        {"factorId": "car", "amount": 380, "unit": "km in a petrol car", "source": SRC},
        {"factorId": "grid", "amount": 91, "unit": "kWh", "source": SRC},
    ]


def test_no_block_without_sourced_figure():
    assert carbon_block({"brand": "X", "lifecycleCo2eKg": None}, FACTORS) is None
    unsourced = {"brand": "X", "lifecycleCo2eKg": {"value": 60, "source": None, "checked": None}}
    assert carbon_block(unsourced, FACTORS) is None
