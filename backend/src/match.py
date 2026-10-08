"""Match a shop listing to a catalog device using identifiers and aliases only.

Aliases are phrases that must appear as whole words. An alias with "+" needs every part,
in any order, so "MacBook Air + M4 + 13" matches "MacBook Air 13-inch laptop with M4 chip".
"""

import re

# Apple part numbers such as MW123 are five characters; listings add a region suffix (MW123HN/A).
MIN_PREFIX_LENGTH = 5


def normalize(text):
    # Keep "+" as a word, so "Galaxy S25+" is not read as "Galaxy S25".
    lowered = str(text).lower().replace("+", " plus ")
    words = re.sub(r"[^a-z0-9]+", " ", lowered).split()
    return f" {' '.join(words)} "


def compact(text):
    return re.sub(r"[^a-z0-9]", "", str(text).lower())


def _has_phrase(normalized_text, phrase):
    phrase = normalize(phrase)
    return phrase.strip() != "" and phrase in normalized_text


def alias_score(normalized_title, alias):
    """Length of the matched alias, or 0 when any part is missing."""
    parts = [part for part in alias.split("+") if part.strip()]
    if not parts or not all(_has_phrase(normalized_title, part) for part in parts):
        return 0
    return sum(len(normalize(part).strip()) for part in parts)


def _identifier_matches(model_number, candidates):
    wanted = compact(model_number)
    if not wanted:
        return False
    return any(
        value == wanted or (len(wanted) >= MIN_PREFIX_LENGTH and value.startswith(wanted))
        for value in candidates
    )


def _candidate(product):
    return {"modelId": product["modelId"], "displayName": product["displayName"]}


def match_listing(title, details, products):
    """Return {modelId, matchType, candidates}. matchType is exact, alias, ambiguous or none."""
    normalized_title = normalize(title)
    # Model numbers can sit in the details table or in the title itself.
    identifiers = [compact(value) for value in details.values() if compact(value)]
    identifiers += [compact(word) for word in normalized_title.split()]

    exact = [
        product
        for product in products
        if any(_identifier_matches(number, identifiers) for number in product.get("modelNumbers", []))
    ]
    if len(exact) == 1:
        return {"modelId": exact[0]["modelId"], "matchType": "exact", "candidates": []}
    if len(exact) > 1:
        return {"modelId": None, "matchType": "ambiguous", "candidates": [_candidate(p) for p in exact]}

    scored = []
    for product in products:
        if any(_has_phrase(normalized_title, word) for word in product.get("excludes", [])):
            continue
        score = max((alias_score(normalized_title, alias) for alias in product.get("aliases", [])), default=0)
        if score:
            scored.append((score, product))

    if not scored:
        return {"modelId": None, "matchType": "none", "candidates": []}

    best = max(score for score, _ in scored)
    top = [product for score, product in scored if score == best]
    if len(top) == 1:
        return {"modelId": top[0]["modelId"], "matchType": "alias", "candidates": []}
    return {"modelId": None, "matchType": "ambiguous", "candidates": [_candidate(p) for p in top]}
