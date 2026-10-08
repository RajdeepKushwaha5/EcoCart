"""Helpers for reading sourced facts from catalog records."""

from datetime import date

MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def is_sourced(fact):
    return isinstance(fact, dict) and bool(fact.get("source")) and bool(fact.get("checked"))


def parse_date(text):
    """Parse YYYY-MM-DD or YYYY-MM. A month-only date becomes the first day of that month."""
    if not isinstance(text, str):
        return None
    parts = text.split("-")
    try:
        if len(parts) == 3:
            return date(int(parts[0]), int(parts[1]), int(parts[2]))
        if len(parts) == 2:
            return date(int(parts[0]), int(parts[1]), 1)
    except ValueError:
        return None
    return None


def month_label(value):
    return f"{MONTHS[value.month - 1]} {value.year}"


def support_end(product):
    policy = product.get("updatePolicy")
    if not is_sourced(policy):
        return None
    return parse_date(policy.get("supportEndDate"))
