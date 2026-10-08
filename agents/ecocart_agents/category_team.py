"""The category team: two Strands agents that sort shop breadcrumbs no rule has matched yet.

  Category Mapper   proposes which product category a breadcrumb belongs to, and the crumb words to add as a rule
  Rule Reviewer     checks the proposal on its own, without seeing the mapper's reasons

A rule is drafted only when both agents pick the same category, the category is one EcoCart already estimates, and the
words really are in the breadcrumb. Drafts go to drafts/rules-<date>.json for a person to approve.
"""

import json
import re
from datetime import date
from pathlib import Path

from pydantic import BaseModel, Field
from strands import Agent, tool

from .models import ask

ROOT = Path(__file__).resolve().parents[2]
ESTIMATES = json.loads((ROOT / "backend" / "src" / "estimates.json").read_text(encoding="utf-8"))
DRAFTS_DIR = ROOT / "drafts"


def categories():
    """Every category the estimate can use: sector code, the label shoppers see, and the dataset's own name."""
    labels = {}
    # General rules first, so a category is named the way it reads outside any one department.
    for rule in sorted(ESTIMATES["rules"], key=lambda rule: bool(rule.get("under"))):
        for target in [rule] + rule.get("byTitle", []):
            if target["sector"] and target["sector"] not in labels:
                labels[target["sector"]] = target["label"]
    return {code: {"label": label, "dataset": ESTIMATES["sectors"][code]["name"]} for code, label in labels.items()}


CATEGORIES = categories()
NONE = "none"


def normalize(text):
    return " ".join(str(text).lower().replace(" and ", " & ").split())


class Proposal(BaseModel):
    category: str = Field(description="A sector code from list_categories, or 'none' if nothing fits or the item is digital, a gift card or a service")
    term: str = Field(description="The words from the breadcrumb that name the product type, copied exactly, usually its last item")
    reason: str


class Review(BaseModel):
    category: str = Field(description="The sector code you think fits best, or 'none'")
    reason: str


MAPPER_PROMPT = """You are the Category Mapper for EcoCart, which estimates a product's footprint from its category.
You get one breadcrumb from Amazon.in or Flipkart that no rule matches yet. Call list_categories, then pick the closest category
for what the product is and what it is made of: shin guards are sports equipment, a rubber duck is a toy. Answer 'none' only for digital
items, gift cards and services. Copy the term exactly from the breadcrumb, usually its last item."""

REVIEWER_PROMPT = """You are the Rule Reviewer for EcoCart. You get one shop breadcrumb. Call list_categories and decide on
your own which category is closest, or 'none' for digital items, gift cards and services. A wrong category gives shoppers
a wrong number, so think about what the product is made of."""


@tool
def list_categories() -> str:
    """The categories EcoCart can estimate, one per line as 'code: label (the dataset's name for it)'."""
    return "\n".join(f"{code}: {item['label']} ({item['dataset']})" for code, item in CATEGORIES.items())


def category_code(answer):
    """A category given as its code, its exact label, or a whole line copied from list_categories; else None.

    Anything outside the list stays outside: the answer must name exactly one known code or label.
    """
    text = str(answer).strip().strip("'\"").strip()
    if text.lower() == NONE:
        return NONE
    codes = {token for token in re.findall(r"\b[0-9A-Z]{6}\b", text) if token in CATEGORIES}
    if len(codes) == 1:
        return codes.pop()
    # "Toys and games (Doll, toy, and game manufacturing)" -> "Toys and games"
    label = re.sub(r"\s*\(.*\)\s*$", "", text).strip().lower()
    by_label = {item["label"].lower(): code for code, item in CATEGORIES.items()}
    return by_label.get(label)


def map_breadcrumb(breadcrumb, model):
    """Return (rule or None, notes) for one breadcrumb such as 'Home & Kitchen > Jars'."""
    crumbs = [part.strip() for part in re.split(r"[>›]", breadcrumb) if part.strip()]
    mapper = Agent(name="Category Mapper", model=model, system_prompt=MAPPER_PROMPT, tools=[list_categories], callback_handler=None)
    proposal = ask(mapper, f"Breadcrumb: {' > '.join(crumbs)}", Proposal)
    if proposal is None:
        return None, "Mapper gave no answer"

    code = category_code(proposal.category)
    term = normalize(proposal.term)
    if code == NONE:
        return None, f"Mapper: no category fits ({proposal.reason})"
    if code is None:
        return None, f"Mapper answered {proposal.category}, which is not a known category"
    if term not in {normalize(crumb) for crumb in crumbs}:
        return None, f"Mapper's term '{proposal.term}' is not one of the breadcrumb items"

    reviewer = Agent(name="Rule Reviewer", model=model, system_prompt=REVIEWER_PROMPT, tools=[list_categories], callback_handler=None)
    review = ask(reviewer, f"Breadcrumb: {' > '.join(crumbs)}", Review)
    if review is None:
        return None, "Reviewer gave no answer"
    if category_code(review.category) != code:
        return None, f"No agreement: mapper chose {code}, reviewer chose {review.category} ({review.reason})"

    rule = {"term": term, "sector": code, "label": CATEGORIES[code]["label"],
            "breadcrumb": " > ".join(crumbs), "mapper": proposal.reason, "reviewer": review.reason}
    return rule, f"Agreed: '{term}' is {rule['label']}"


def map_gaps(breadcrumbs, model):
    rules, notes = [], []
    for breadcrumb in breadcrumbs:
        rule, note = map_breadcrumb(breadcrumb, model)
        print(f"[Category team] {breadcrumb}: {note}", flush=True)
        notes.append({"breadcrumb": breadcrumb, "note": note})
        if rule:
            rules.append(rule)
    DRAFTS_DIR.mkdir(exist_ok=True)
    path = DRAFTS_DIR / f"rules-{date.today().isoformat()}.json"
    # Runs on the same day add to one draft, so nothing waiting for review is lost.
    draft = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {"rules": [], "notes": []}
    terms = {rule["term"] for rule in draft["rules"]}
    draft["rules"] += [rule for rule in rules if rule["term"] not in terms]
    draft["notes"] += notes
    path.write_text(json.dumps(draft, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path, rules
