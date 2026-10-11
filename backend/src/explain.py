"""Short plain-language summary of a phone's facts.

The template text is always available. A Bedrock summary is used only when a model is
configured and its output passes validation against the supplied facts.
"""

import json
import logging
import os
import re

from facts import MONTHS, is_sourced, month_label, parse_date, support_end

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You write a two sentence note for a phone shopper in India. "
    "Use only the facts in the user message. If a fact is null, say it is not published. "
    "Do not add numbers, claims, rankings or comparisons that are not in the facts. "
    'Reply with JSON only, in the form {"en": "..."}.'
)

BANNED_PHRASES = [
    "eco-friendly", "eco friendly", "greener", "sustainable", "better for the environment",
    "lower emissions", "lower carbon", "best", "we recommend", "you should buy",
]

NUMBER_PATTERN = re.compile(r"\d+(?:\.\d+)?")


def template_summary(product, carbon=None):
    brand = product["brand"]
    name = product["displayName"]
    policy = product.get("updatePolicy")
    end = support_end(product)

    if end is not None:
        first = f"{brand} promises security updates for the {name} until at least {month_label(end)}."
    elif is_sourced(policy) and policy.get("value"):
        first = f"{brand} states this update policy for the {name}: \"{policy['value']}\"."
    else:
        first = f"An update policy for the {name} is not published in a source we could check."

    co2 = product.get("lifecycleCo2eKg")
    if is_sourced(co2) and isinstance(co2.get("value"), (int, float)):
        second = f"{brand} reports a lifecycle footprint of {co2['value']} kg CO₂e for this model"
        comparisons = (carbon or {}).get("equivalents") or []
        if comparisons:
            first_comparison = comparisons[0]
            second += f", roughly the same as {first_comparison['amount']:,} {first_comparison['unit']}"
        second += "."
    else:
        second = "Lifecycle emissions for this model are not published."

    return f"{first} {second}"


def facts_for_prompt(product, alternative, carbon=None):
    def value_of(key):
        fact = product.get(key)
        return fact.get("value") if is_sourced(fact) else None

    policy = product.get("updatePolicy") if is_sourced(product.get("updatePolicy")) else {}
    return {
        "phone": product["displayName"],
        "brand": product["brand"],
        "updatePolicy": policy.get("value"),
        "supportEndDate": policy.get("supportEndDate"),
        "repairability": value_of("repairability"),
        "lifecycleCo2eKg": value_of("lifecycleCo2eKg"),
        "comparisons": [
            {"amount": item["amount"], "unit": item["unit"]} for item in (carbon or {}).get("equivalents", [])
        ],
        "alternative": None if alternative is None else {
            "phone": alternative["displayName"],
            "supportEndDate": alternative["supportEndDate"],
        },
    }


def _numbers(text):
    return {number.lstrip("0") or "0" for number in NUMBER_PATTERN.findall(text.replace(",", ""))}


def _months_in(text):
    lowered = text.lower()
    return {month for month in MONTHS if month.lower() in lowered}


def _allowed_months(facts):
    months = set()
    for value in (facts["supportEndDate"], (facts["alternative"] or {}).get("supportEndDate")):
        parsed = parse_date(value)
        if parsed is not None:
            months.add(MONTHS[parsed.month - 1])
    return months


def is_grounded(text, facts, known_brands):
    """Reject text that adds numbers, months, brands or claims that the facts do not contain."""
    if not isinstance(text, str) or not 20 <= len(text) <= 400:
        return False
    if len(re.findall(r"[.!?](?:\s|$)", text)) > 3:
        return False

    lowered = text.lower()
    if any(phrase in lowered for phrase in BANNED_PHRASES):
        return False

    facts_text = json.dumps(facts)
    if not _numbers(text) <= _numbers(facts_text):
        return False
    if not _months_in(text) <= _allowed_months(facts):
        return False

    allowed_brands = {facts["brand"].lower()}
    if facts["alternative"]:
        allowed_brands.update(word.lower() for word in facts["alternative"]["phone"].split())
    for brand in known_brands:
        if re.search(rf"\b{re.escape(brand.lower())}\b", lowered) and brand.lower() not in allowed_brands:
            return False
    return True


def _bedrock_text(model_id, facts):
    import boto3

    client = boto3.client("bedrock-runtime")
    response = client.converse(
        modelId=model_id,
        system=[{"text": SYSTEM_PROMPT}],
        messages=[{"role": "user", "content": [{"text": json.dumps(facts)}]}],
        inferenceConfig={"maxTokens": 200, "temperature": 0},
    )
    raw = response["output"]["message"]["content"][0]["text"].strip()
    raw = raw.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
    return json.loads(raw).get("en")


def summarize(product, alternative, known_brands, carbon=None):
    """Return (text, source) where source is 'bedrock' or 'template'."""
    model_id = os.environ.get("BEDROCK_MODEL_ID", "")
    if model_id:
        facts = facts_for_prompt(product, alternative, carbon)
        try:
            text = _bedrock_text(model_id, facts)
            if is_grounded(text, facts, known_brands):
                return text.strip(), "bedrock"
            logger.warning("Bedrock summary rejected by validation for %s", product["modelId"])
        except Exception:
            logger.exception("Bedrock summary failed for %s", product["modelId"])
    return template_summary(product, carbon), "template"
