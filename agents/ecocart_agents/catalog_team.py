"""The catalog research team: four Strands agents that draft a catalog entry from official documents.

  Catalog Lead      plans the work and calls the other three as tools
  Source Scout      finds the maker's own documents for the model, on the maker's own domains only
  Fact Extractor    reads a document and quotes the passage behind each fact
  Evidence Checker  explains, for a reviewer, what the quote check kept and dropped

The agents propose; plain code decides. Quotes are checked word for word by evidence.verify, the result is kept in
the Research object, and save_draft writes only what is in there, never what a model says it found.
"""

import json
import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from urllib.parse import urljoin, urlsplit

from pydantic import BaseModel, Field
from strands import Agent, tool

from . import evidence
from .models import ask

SOURCES = json.loads((Path(__file__).parent / "official_sources.json").read_text(encoding="utf-8"))["makers"]
DRAFTS_DIR = Path(__file__).resolve().parents[2] / "drafts"
MAX_LINKS = 15


# ---------- Shared state for one run ----------

@dataclass
class Research:
    brand: str
    name: str
    category: str
    checked: str = field(default_factory=lambda: date.today().isoformat())
    documents: dict = field(default_factory=dict)
    pending: dict = field(default_factory=dict)  # url -> extracted claims, not yet checked
    bases: dict = field(default_factory=dict)  # url -> configuration the carbon figure is for
    results: list = field(default_factory=list)  # (url, verified facts, notes), filled only by check_facts
    log: list = field(default_factory=list)
    saved: bool = False

    def say(self, who, text):
        line = f"[{who}] {plain(text)}"
        self.log.append(line)
        print(line, flush=True)


def plain(text):
    """An agent's answer without the reasoning some local models print before it."""
    return re.sub(r"<think>.*?</think>", "", str(text), flags=re.S).strip()


def maker(brand):
    for name, entry in SOURCES.items():
        if name.lower() == brand.lower():
            return entry
    return {"domains": [], "pages": []}


def allowed(url, brand):
    host = urlsplit(url).hostname or ""
    return url.startswith("https://") and any(host == d or host.endswith(f".{d}") for d in maker(brand)["domains"])


def read(research, url):
    if url not in research.documents:
        research.documents[url] = evidence.fetch(url)
    return research.documents[url]


# ---------- Typed answers from the agents ----------

class SourcePick(BaseModel):
    urls: list[str] = Field(description="Official document URLs for this exact model, best first, at most 3")
    reason: str = Field(description="One sentence on why these documents")


class Extraction(BaseModel):
    update_quote: str | None = Field(None, description="Exact sentence stating how long security updates last")
    support_end_date: str | None = Field(None, description="YYYY-MM or YYYY-MM-DD, only if the quote states it")
    carbon_quote: str | None = Field(None, description="Exact text stating the lifecycle carbon footprint")
    carbon_kg: float | None = Field(None, description="The kg CO2e figure inside carbon_quote")
    carbon_basis: str | None = Field(None, description="The configuration the figure is for, copied from carbon_quote, such as '256GB'")
    take_back_quote: str | None = None
    take_back: bool | None = None
    model_numbers: list[str] = Field(default_factory=list)


# ---------- The specialists ----------

SCOUT_PROMPT = """You are the Source Scout for EcoCart, a shopping assistant in India.
Find the maker's own documents about one exact device model. Start from list_official_pages, then use list_links to find
links on those pages that are about this model. Only pick documents for this exact model (an 'iPhone 18 Pro' report is not
an 'iPhone 18' report). Pick at most 3. Never invent a URL."""

EXTRACTOR_PROMPT = """You are the Fact Extractor for EcoCart. Call read_document once, then report what the passages state
about the given model. Copy every quote character for character from the passages. If a fact is not stated for this exact
model, leave it null. Do not calculate or guess anything."""

CHECKER_PROMPT = """You are the Evidence Checker for EcoCart. You receive the result of an automatic word-for-word quote check.
Write a short review for a human: which facts were kept, which were dropped and why, in plain sentences. Do not change the result."""


def scout_agent(research, model):
    @tool
    def list_official_pages() -> str:
        """The maker's official pages that EcoCart trusts, with what each one holds."""
        pages = maker(research.brand)["pages"]
        return json.dumps(pages) if pages else "No official pages are registered for this maker."

    @tool
    def list_links(url: str, keyword: str) -> str:
        """Links on an official page whose text or address mentions every word of the keyword."""
        if not allowed(url, research.brand):
            return "That page is not on the maker's official domains."
        raw = evidence.fetch_raw(url)
        words = [w for w in re.split(r"[^a-z0-9]+", keyword.lower()) if w]
        found = []
        for href, text in re.findall(r'<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>', raw, re.S | re.I):
            absolute = urljoin(url, href)
            label = " ".join(evidence.html_text(text).split())
            haystack = f"{label} {absolute}".lower().replace("_", " ").replace("-", " ").replace("%20", " ")
            if all(w in haystack for w in words) and allowed(absolute, research.brand):
                found.append({"text": label[:80], "url": absolute})
        unique = list({item["url"]: item for item in found}.values())[:MAX_LINKS]
        return json.dumps(unique) if unique else "No matching links on that page."

    return Agent(name="Source Scout", model=model, system_prompt=SCOUT_PROMPT, callback_handler=None,
                 tools=[list_official_pages, list_links])


def extractor_agent(research, model, url):
    @tool
    def read_document() -> str:
        """The passages of the document that mention the model."""
        passages = evidence.passages_about(read(research, url), research.name)
        return passages or f"The document does not mention {research.name}."

    return Agent(name="Fact Extractor", model=model, system_prompt=EXTRACTOR_PROMPT, callback_handler=None,
                 tools=[read_document])


def as_answer(extraction):
    """The extractor's typed answer in the shape evidence.verify expects."""
    return {
        "updatePolicy": {"quote": extraction.update_quote, "supportEndDate": extraction.support_end_date} if extraction.update_quote else None,
        "lifecycleCo2eKg": {"quote": extraction.carbon_quote, "value": extraction.carbon_kg} if extraction.carbon_quote else None,
        "takeBack": {"quote": extraction.take_back_quote, "value": extraction.take_back} if extraction.take_back_quote else None,
        "modelNumbers": extraction.model_numbers,
    }


# ---------- The lead ----------

LEAD_PROMPT = """You are the Catalog Lead for EcoCart. Your team drafts a catalog entry for one device from official documents.
Steps: call find_sources (unless sources were given), then extract_facts and check_facts for each source, then save_draft.
Only save_draft decides what is saved, and it saves only checked facts. Finish with a two sentence summary."""


def lead_agent(research, model, given_sources=None):
    @tool
    def find_sources() -> str:
        """Ask the Source Scout for official documents about the model."""
        if given_sources:
            return json.dumps(given_sources)
        research.say("Source Scout", f"looking for official documents on {research.name}")
        pick = ask(scout_agent(research, model),
                   f"Find official documents for the {research.brand} {research.name} ({research.category}).", SourcePick)
        if pick is None:
            return "The Source Scout found nothing."
        urls = [url for url in pick.urls if allowed(url, research.brand)][:3]
        research.say("Source Scout", f"picked {urls or 'nothing'}: {pick.reason}")
        return json.dumps(urls)

    @tool
    def extract_facts(url: str) -> str:
        """Ask the Fact Extractor what one document says about the model, with quotes."""
        if not allowed(url, research.brand) and url not in (given_sources or []):
            return "That URL is not an official source."
        research.say("Fact Extractor", f"reading {url}")
        extraction = ask(extractor_agent(research, model, url), f"Report the facts about the {research.brand} {research.name}.", Extraction)
        if extraction is None:
            return "The Fact Extractor gave no answer for this document."
        research.pending[url] = as_answer(extraction)
        research.bases[url] = extraction.carbon_basis
        return extraction.model_dump_json()

    @tool
    def check_facts(url: str) -> str:
        """Check the extracted quotes against the document word for word, and keep only what passes."""
        answer = research.pending.get(url)
        if answer is None:
            return "Run extract_facts on this URL first."
        facts, notes = evidence.verify(answer, read(research, url), url, research.checked)
        basis = research.bases.get(url)
        # The configuration is kept only if the checked quote names it.
        if "lifecycleCo2eKg" in facts and basis and evidence.squash(basis) in evidence.squash(facts["lifecycleCo2eKg"]["_quote"]):
            facts["lifecycleCo2eKg"]["basis"] = basis
        research.results.append((url, facts, notes))
        kept = sorted(key for key in facts if key != "modelNumbers")
        checker = Agent(name="Evidence Checker", model=model, system_prompt=CHECKER_PROMPT, callback_handler=None)
        review = ask(checker, json.dumps({"source": url, "kept": kept, "dropped": notes}))
        research.say("Evidence Checker", review or f"kept {kept}, dropped {notes}")
        return json.dumps({"kept": kept, "dropped": notes})

    @tool
    def save_draft() -> str:
        """Write the draft from the checked facts only, for a person to review."""
        draft = build_draft(research)
        DRAFTS_DIR.mkdir(exist_ok=True)
        path = DRAFTS_DIR / f"{draft['modelId']}.json"
        path.write_text(json.dumps(draft, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        research.saved = True
        research.say("Catalog Lead", f"draft saved to drafts/{path.name}")
        return f"Saved drafts/{path.name}"

    return Agent(name="Catalog Lead", model=model, system_prompt=LEAD_PROMPT, callback_handler=None,
                 tools=[find_sources, extract_facts, check_facts, save_draft])


# ---------- Draft ----------

def slug(text):
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")


def build_draft(research):
    """The same draft format as before: a catalog entry plus the quotes and notes a reviewer needs."""
    entry = {
        "modelId": slug(f"{research.brand} {research.name}"), "brand": research.brand,
        "displayName": f"{research.brand} {research.name}", "category": research.category,
        "aliases": [research.name], "modelNumbers": [], "excludes": [],
        "priceInr": None, "updatePolicy": None, "repairability": None, "lifecycleCo2eKg": None, "takeBack": None,
    }
    review = {"quotes": {}, "notes": [], "agentLog": research.log}
    for url, facts, notes in research.results:
        review["notes"].extend(notes)
        for number in facts.get("modelNumbers", []):
            if number not in entry["modelNumbers"]:
                entry["modelNumbers"].append(number)
        for key in ("updatePolicy", "lifecycleCo2eKg", "takeBack"):
            if key in facts and entry[key] is None:
                fact = dict(facts[key])
                review["quotes"][key] = {"quote": fact.pop("_quote", fact.get("value")), "source": url}
                entry[key] = fact
    return {**entry, "_review": review}


def research_device(brand, name, category, model, sources=None):
    research = Research(brand=brand, name=name, category=category)
    lead = lead_agent(research, model, sources)
    research.say("Catalog Lead", f"starting on the {brand} {name}")
    summary = ask(lead, f"Draft a catalog entry for the {brand} {name} ({category}).")
    research.say("Catalog Lead", summary or "finished")
    if not research.saved:
        # The lead is told to save; if it did not, the checked facts are still written.
        lead.tool.save_draft()
    return research
