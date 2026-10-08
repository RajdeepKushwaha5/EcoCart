import explain
from explain import facts_for_prompt, is_grounded, summarize, template_summary

SRC = "https://example.com"
BRANDS = ["Apple", "Google", "Samsung"]

PRODUCT = {
    "modelId": "a55",
    "brand": "Samsung",
    "displayName": "Galaxy A55 5G",
    "updatePolicy": {"value": "Six years of security updates", "supportEndDate": "2030-03", "source": SRC, "checked": "2026-10-01"},
    "repairability": None,
    "lifecycleCo2eKg": None,
}


def test_template_uses_end_date_and_unknown_emissions():
    assert template_summary(PRODUCT) == (
        "Samsung promises security updates for the Galaxy A55 5G until at least March 2030. "
        "Lifecycle emissions for this model are not published."
    )


def test_template_adds_first_everyday_comparison():
    product = dict(PRODUCT, lifecycleCo2eKg={"value": 47.9, "source": SRC, "checked": "2026-10-01"})
    carbon = {"equivalents": [{"amount": 340, "unit": "km in a petrol hatchback"}, {"amount": 67, "unit": "kWh"}]}
    assert template_summary(product, carbon).endswith(
        "Samsung reports a lifecycle footprint of 47.9 kg CO2e for this model, "
        "roughly the same as 340 km in a petrol hatchback."
    )


def test_template_without_policy():
    product = dict(PRODUCT, updatePolicy=None)
    assert template_summary(product).startswith("An update policy for the Galaxy A55 5G is not published")


def test_grounded_text_passes():
    facts = facts_for_prompt(PRODUCT, None)
    text = "Samsung promises security updates for the Galaxy A55 5G until March 2030. Its lifecycle emissions are not published."
    assert is_grounded(text, facts, BRANDS)


def test_rejects_new_number_month_brand_or_claim():
    facts = facts_for_prompt(PRODUCT, None)
    assert not is_grounded("Samsung supports the Galaxy A55 5G until March 2031, which is long.", facts, BRANDS)
    assert not is_grounded("Samsung supports the Galaxy A55 5G until April 2030, which is long.", facts, BRANDS)
    assert not is_grounded("The Galaxy A55 5G gets updates until March 2030, longer than Apple phones.", facts, BRANDS)
    assert not is_grounded("The Galaxy A55 5G is a sustainable choice with updates until March 2030.", facts, BRANDS)


def test_summarize_falls_back_to_template_without_model(monkeypatch):
    monkeypatch.delenv("BEDROCK_MODEL_ID", raising=False)
    assert summarize(PRODUCT, None, BRANDS) == (template_summary(PRODUCT), "template")


def test_summarize_rejects_ungrounded_bedrock_output(monkeypatch):
    monkeypatch.setenv("BEDROCK_MODEL_ID", "test-model")
    monkeypatch.setattr(explain, "_bedrock_text", lambda model_id, facts: "This phone saves 40 kg of CO2.")
    assert summarize(PRODUCT, None, BRANDS)[1] == "template"


def test_summarize_accepts_grounded_bedrock_output(monkeypatch):
    monkeypatch.setenv("BEDROCK_MODEL_ID", "test-model")
    text = "Samsung promises security updates for the Galaxy A55 5G until March 2030. Emissions are not published."
    monkeypatch.setattr(explain, "_bedrock_text", lambda model_id, facts: text)
    assert summarize(PRODUCT, None, BRANDS) == (text, "bedrock")
