"""Manufacturer-reported lifecycle carbon, and everyday comparisons built from sourced factors."""

from math import floor, log10

from facts import is_sourced


def round_significant(value, digits=2):
    if value == 0:
        return 0
    rounded = round(value, digits - 1 - floor(log10(abs(value))))
    return int(rounded) if rounded == int(rounded) else rounded


def usable_factors(factors):
    """Sourced factors in their set order. The table is scanned in no particular order, so the order is stored."""
    usable = [
        factor for factor in factors
        if is_sourced(factor) and isinstance(factor.get("kgCo2ePerUnit"), (int, float)) and factor["kgCo2ePerUnit"] > 0
    ]
    return sorted(usable, key=lambda factor: factor.get("order", 99))


def carbon_block(product, factors):
    """Return None when the manufacturer has not published a sourced lifecycle figure."""
    fact = product.get("lifecycleCo2eKg")
    if not is_sourced(fact) or not isinstance(fact.get("value"), (int, float)) or fact["value"] <= 0:
        return None

    kg = fact["value"]
    return {
        "kg": kg,
        "reportedBy": product["brand"],
        "basis": fact.get("basis"),
        "source": fact["source"],
        "checked": fact["checked"],
        "equivalents": [
            {
                "factorId": factor["factorId"],
                "amount": round_significant(kg / factor["kgCo2ePerUnit"]),
                "unit": factor["unit"],
                "source": factor["source"],
            }
            for factor in usable_factors(factors)
        ],
    }
