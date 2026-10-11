"""The teams with stand-in agents: these tests check what code decides, not what a model says."""

import json
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ecocart_agents import catalog_team, category_team, evidence  # noqa: E402
from ecocart_agents.catalog_team import Extraction, Research, allowed, as_answer, build_draft  # noqa: E402

PAGE = "<p>The Apple Watch Series 12 has a product carbon footprint of 8 kg CO2e.</p>"
URL = "https://www.apple.com/environment/pdf/products/watch/Apple_Watch_Series_12_PER_Sept2026.pdf"


def fake_agent(answers):
    """An Agent stand-in that returns the next typed answer each time it is called."""
    queue = list(answers)

    class FakeAgent:
        def __init__(self, **_):
            pass

        def __call__(self, *_args, **_kwargs):
            return SimpleNamespace(structured_output=queue.pop(0))

    return FakeAgent


def test_scout_may_only_open_the_makers_own_domains():
    assert allowed(URL, "Apple")
    assert allowed("https://regulatoryinfo.apple.com/cwt/api/ext/file?fileId=x", "Apple")
    assert not allowed("https://www.gsmarena.com/apple_watch_series_12.php", "Apple")
    assert not allowed("http://www.apple.com/environment/", "Apple")
    assert not allowed(URL, "Unknown brand")


def test_only_checked_facts_reach_the_draft():
    research = Research(brand="Apple", name="Watch Series 12", category="watch")
    text = evidence.html_text(PAGE)
    claimed = as_answer(Extraction(
        carbon_quote="product carbon footprint of 8 kg CO2e", carbon_kg=8,
        update_quote="Updates for ten years guaranteed", support_end_date="2036-09",
    ))
    facts, notes = evidence.verify(claimed, text, URL, "2026-10-02")
    research.results.append((URL, facts, notes))
    draft = build_draft(research)
    assert draft["lifecycleCo2eKg"]["value"] == 8
    assert draft["updatePolicy"] is None
    assert any("quote not found" in note for note in draft["_review"]["notes"])


def test_category_rule_needs_both_agents_to_agree(monkeypatch):
    code = next(iter(category_team.CATEGORIES))
    proposal = category_team.Proposal(category=code, term="Kites", reason="kites are toys")
    monkeypatch.setattr(category_team, "Agent", fake_agent([proposal, category_team.Review(category=code, reason="agree")]))
    rule, note = category_team.map_breadcrumb("Toys & Games > Kites", model=None)
    assert rule["term"] == "kites" and rule["sector"] == code

    other = [c for c in category_team.CATEGORIES if c != code][0]
    monkeypatch.setattr(category_team, "Agent", fake_agent([proposal, category_team.Review(category=other, reason="no")]))
    rule, note = category_team.map_breadcrumb("Toys & Games > Kites", model=None)
    assert rule is None and note.startswith("No agreement")


def test_category_rule_rejects_made_up_categories_and_terms(monkeypatch):
    bad_code = category_team.Proposal(category="999999", term="Kites", reason="x")
    monkeypatch.setattr(category_team, "Agent", fake_agent([bad_code]))
    assert category_team.map_breadcrumb("Toys & Games > Kites", model=None)[0] is None

    code = next(iter(category_team.CATEGORIES))
    bad_term = category_team.Proposal(category=code, term="Flying toys", reason="x")
    monkeypatch.setattr(category_team, "Agent", fake_agent([bad_term]))
    rule, note = category_team.map_breadcrumb("Toys & Games > Kites", model=None)
    assert rule is None and "not one of the breadcrumb items" in note


def test_categories_are_the_ones_the_estimate_uses():
    estimates = json.loads((Path(__file__).resolve().parents[2] / "backend" / "src" / "estimates.json").read_text(encoding="utf-8"))
    assert set(category_team.CATEGORIES) <= set(estimates["sectors"])


def test_category_answers_may_be_a_code_or_an_exact_label():
    code, item = next(iter(category_team.CATEGORIES.items()))
    assert category_team.category_code(f'"{code}"') == code
    assert category_team.category_code(item["label"].upper()) == code
    assert category_team.category_code("None") == "none"
    assert category_team.category_code("Something made up") is None


def test_a_whole_line_from_the_list_is_understood():
    code, item = next(iter(category_team.CATEGORIES.items()))
    assert category_team.category_code(f"{code}: {item['label']} ({item['dataset']})") == code
    assert category_team.category_code(f"{item['label']} ({item['dataset']})") == code
    two = list(category_team.CATEGORIES)[:2]
    assert category_team.category_code(f"{two[0]} or {two[1]}") is None


def test_runs_on_the_same_day_add_to_one_draft(monkeypatch, tmp_path):
    monkeypatch.setattr(category_team, "DRAFTS_DIR", tmp_path)
    code = next(iter(category_team.CATEGORIES))
    for term in ("Kites", "Kites", "Yo-yos"):
        rule = {"term": term.lower(), "sector": code}
        monkeypatch.setattr(category_team, "map_breadcrumb", lambda crumb, model, rule=rule: (rule, "Agreed"))
        path, _ = category_team.map_gaps([f"Toys > {term}"], model=None)
    draft = json.loads(path.read_text(encoding="utf-8"))
    assert [rule["term"] for rule in draft["rules"]] == ["kites", "yo-yos"]
    # A breadcrumb already in today's draft is skipped, so a long run can stop and resume.
    assert [note["breadcrumb"] for note in draft["notes"]] == ["Toys > Kites", "Toys > Yo-yos"]
