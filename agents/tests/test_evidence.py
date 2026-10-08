import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from ecocart_agents import evidence  # noqa: E402
from ecocart_agents.evidence import date_in, passages_about, verify  # noqa: E402

URL = "https://example.com/psti"
PAGE = """
<html><body><table>
<tr><td>OnePlus 13R</td><td>CPH2645</td><td>Security update period ends 7 Jan 2031</td></tr>
<tr><td>OnePlus 13</td><td>CPH2649</td><td>Security update period ends 7 Jan 2030</td></tr>
</table><p>The OnePlus 13R has a product carbon footprint of 61.5 kg CO2e.</p></body></html>
"""


def answer(**changes):
    base = {
        "updatePolicy": {"quote": "Security update period ends 7 Jan 2031", "supportEndDate": "2031-01-07"},
        "lifecycleCo2eKg": {"quote": "product carbon footprint of 61.5 kg CO2e", "value": 61.5},
        "takeBack": None,
        "modelNumbers": ["CPH2645"],
    }
    return {**base, **changes}


def text():
    return evidence.html_text(PAGE)


def test_verified_facts_are_kept():
    facts, notes = verify(answer(), text(), URL, "2026-10-02")
    assert facts["updatePolicy"]["supportEndDate"] == "2031-01-07"
    assert facts["lifecycleCo2eKg"]["value"] == 61.5
    assert facts["modelNumbers"] == ["CPH2645"]
    assert notes == []


def test_invented_quote_is_dropped():
    facts, notes = verify(answer(updatePolicy={"quote": "Seven years of updates guaranteed", "supportEndDate": "2032-01"}),
                          text(), URL, "2026-10-02")
    assert "updatePolicy" not in facts
    assert "quote not found" in notes[0]


def test_number_must_be_in_the_quote():
    facts, notes = verify(answer(lifecycleCo2eKg={"quote": "product carbon footprint of 61.5 kg CO2e", "value": 65}),
                          text(), URL, "2026-10-02")
    assert "lifecycleCo2eKg" not in facts
    assert "does not appear" in notes[0]


def test_unstated_end_date_is_removed_but_wording_kept():
    facts, _ = verify(answer(updatePolicy={"quote": "Security update period ends 7 Jan 2031", "supportEndDate": "2031-06"}),
                      text(), URL, "2026-10-02")
    assert facts["updatePolicy"]["supportEndDate"] is None
    assert facts["updatePolicy"]["value"] == "Security update period ends 7 Jan 2031"


def test_model_numbers_must_be_in_the_source():
    facts, notes = verify(answer(modelNumbers=["CPH2645", "CPH9999"]), text(), URL, "2026-10-02")
    assert facts["modelNumbers"] == ["CPH2645"]
    assert "CPH9999" in notes[0]


@pytest.mark.parametrize("value, quote, ok", [
    ("2031-01-07", "ends 7 Jan 2031", True),
    ("2031-01", "until 01/2031", True),
    ("2031-02", "ends 7 Jan 2031", False),
    ("2030-01", "ends 7 Jan 2031", False),
    ("soon", "ends 7 Jan 2031", False),
])
def test_date_in(value, quote, ok):
    assert date_in(value, quote) is ok


def test_passages_only_cover_the_model():
    long_text = "filler " * 2000 + "The OnePlus 13R gets updates." + " filler" * 2000
    passages = passages_about(long_text, "OnePlus 13R")
    assert "OnePlus 13R" in passages and len(passages) < 1400
    assert passages_about("nothing here", "OnePlus 13R") == ""
