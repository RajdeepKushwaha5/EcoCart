"""Reading official documents and checking quotes against them. No model is involved here.

Every fact an agent reports has to come with a quote. A fact is kept only when its quote appears word for word in the
source and the quote contains the value. This module is the part that decides, so it is plain code with tests.
"""

import html
import io
import logging
import re
import urllib.request

USER_AGENT = "Mozilla/5.0 (EcoCart catalog research)"
# Makers' PDFs use fonts pypdf warns about at length; the text still comes out fine.
logging.getLogger("pypdf").setLevel(logging.ERROR)
PASSAGE_RADIUS = 600
MAX_PASSAGE_CHARS = 9000
# Curly quotes, non-breaking space and dashes, written as code points: they read the same as plain ones.
TYPOGRAPHY = str.maketrans({0x2018: "'", 0x2019: "'", 0x201C: '"', 0x201D: '"', 0x00A0: " ", 0x2013: "-", 0x2014: "-"})


# ---------- Reading sources ----------

def fetch_raw(url):
    """The page as served, for reading its links."""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read().decode("utf-8", errors="replace")


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        body = response.read()
        kind = response.headers.get("Content-Type", "")
    if "pdf" in kind or url.lower().endswith(".pdf"):
        return pdf_text(body)
    return html_text(body.decode("utf-8", errors="replace"))


def pdf_text(data):
    from pypdf import PdfReader

    return "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(data)).pages)


def html_text(markup):
    markup = re.sub(r"(?is)<(script|style|noscript)\b.*?</\1>", " ", markup)
    markup = re.sub(r"(?i)<(br|/p|/div|/li|/tr|/h\d)\b[^>]*>", "\n", markup)
    markup = re.sub(r"(?i)</t[dh]>", " | ", markup)
    return html.unescape(re.sub(r"<[^>]+>", " ", markup))


def squash(text):
    """Compare text the way a reader would: case, spacing and curly quotes do not matter."""
    text = text.translate(TYPOGRAPHY)
    return " ".join(text.lower().split())


def passages_about(text, name):
    """The parts of a long document around each mention of the model, so the prompt stays small."""
    flat = " ".join(text.split())
    spans = [(max(0, m.start() - PASSAGE_RADIUS), m.end() + PASSAGE_RADIUS)
             for m in re.finditer(re.escape(name), flat, re.IGNORECASE)]
    if not spans:
        return ""
    merged = [list(spans[0])]
    for start, end in spans[1:]:
        if start <= merged[-1][1]:
            merged[-1][1] = end
        else:
            merged.append([start, end])
    return "\n...\n".join(flat[start:end] for start, end in merged)[:MAX_PASSAGE_CHARS]


# ---------- Checking the answer ----------

def quote_found(quote, source_text):
    return isinstance(quote, str) and len(quote.strip()) >= 10 and squash(quote) in squash(source_text)


def number_in(value, quote):
    numbers = {float(n) for n in re.findall(r"\d+(?:\.\d+)?", quote.replace(",", ""))}
    return isinstance(value, (int, float)) and not isinstance(value, bool) and float(value) in numbers


MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]


def date_in(value, quote):
    """The quote must state the year and the month (as a name or a number) of the support end date."""
    match = re.fullmatch(r"(\d{4})-(\d{2})(?:-(\d{2}))?", value or "")
    if not match:
        return False
    year, month = match.group(1), int(match.group(2))
    lowered = quote.lower()
    if year not in lowered or not 1 <= month <= 12:
        return False
    return MONTH_NAMES[month - 1] in lowered or re.search(rf"\b0?{month}[/.-]|[/.-]0?{month}\b", lowered) is not None


def verify(answer, source_text, url, checked):
    """Return (facts, notes). Only facts whose quote and value check out are kept."""
    facts, notes = {}, []

    policy = answer.get("updatePolicy")
    if policy:
        quote = policy.get("quote", "")
        end = policy.get("supportEndDate") or None
        if not quote_found(quote, source_text):
            notes.append(f"updatePolicy dropped: quote not found in {url}")
        elif end and not date_in(end, quote):
            notes.append(f"updatePolicy kept without supportEndDate: {end} is not stated in the quote")
            facts["updatePolicy"] = {"value": quote.strip(), "supportEndDate": None, "source": url, "checked": checked}
        else:
            facts["updatePolicy"] = {"value": quote.strip(), "supportEndDate": end, "source": url, "checked": checked}

    carbon = answer.get("lifecycleCo2eKg")
    if carbon:
        quote = carbon.get("quote", "")
        if not quote_found(quote, source_text):
            notes.append(f"lifecycleCo2eKg dropped: quote not found in {url}")
        elif not number_in(carbon.get("value"), quote):
            notes.append(f"lifecycleCo2eKg dropped: {carbon.get('value')} does not appear in the quote")
        else:
            facts["lifecycleCo2eKg"] = {"value": carbon["value"], "source": url, "checked": checked, "_quote": quote.strip()}

    take_back = answer.get("takeBack")
    if take_back:
        quote = take_back.get("quote", "")
        if not quote_found(quote, source_text) or not isinstance(take_back.get("value"), bool):
            notes.append(f"takeBack dropped: quote not found in {url} or value is not true/false")
        else:
            facts["takeBack"] = {"value": take_back["value"], "source": url, "checked": checked, "_quote": quote.strip()}

    numbers = [n for n in answer.get("modelNumbers") or [] if isinstance(n, str) and squash(n) in squash(source_text)]
    dropped = set(answer.get("modelNumbers") or []) - set(numbers)
    if dropped:
        notes.append(f"model numbers dropped, not in {url}: {sorted(dropped)}")
    facts["modelNumbers"] = numbers
    return facts, notes
