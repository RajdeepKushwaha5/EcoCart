"""Review category rules drafted by the agents' category team and add them to data/sectors.json.

Each drafted rule adds one breadcrumb term to the general rule for its category. Shows every rule with both agents'
reasons, asks for a yes, then rebuilds backend/src/estimates.json. Deploy afterwards for the API to use them.

Run: python scripts/approve_rules.py drafts/rules-YYYY-MM-DD.json
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SECTORS = ROOT / "data" / "sectors.json"


def write_sectors(data):
    lines = ["{", f'  "about": {json.dumps(data["about"])},', '  "rules": [']
    for index, rule in enumerate(data["rules"]):
        lines.append("    " + json.dumps(rule, ensure_ascii=False) + ("," if index < len(data["rules"]) - 1 else ""))
    lines += ["  ]", "}"]
    SECTORS.write_text("\n".join(lines) + "\n", encoding="utf-8")


def merge(data, rules):
    """Return (added, skipped). Terms already in a general rule are skipped."""
    general = [rule for rule in data["rules"] if not rule.get("under")]
    used = {term for rule in general for term in rule["crumbs"]}
    added, skipped = [], []
    for proposal in rules:
        target = next((rule for rule in general if rule["sector"] == proposal["sector"]), None)
        if target is None or proposal["term"] in used:
            skipped.append(proposal["term"])
            continue
        target["crumbs"].append(proposal["term"])
        used.add(proposal["term"])
        added.append(proposal["term"])
    return added, skipped


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("draft", type=Path)
    args = parser.parse_args()

    rules = json.loads(args.draft.read_text(encoding="utf-8"))["rules"]
    if not rules:
        sys.exit("The draft has no agreed rules.")
    for rule in rules:
        print(f"\n'{rule['term']}' -> {rule['label']} ({rule['sector']})")
        print(f"   breadcrumb: {rule['breadcrumb']}")
        print(f"   mapper:     {rule['mapper']}")
        print(f"   reviewer:   {rule['reviewer']}")
    if input("\nAdd these rules to data/sectors.json? Type yes to confirm: ").strip().lower() != "yes":
        sys.exit("Not added.")

    data = json.loads(SECTORS.read_text(encoding="utf-8"))
    added, skipped = merge(data, rules)
    write_sectors(data)
    subprocess.run([sys.executable, str(ROOT / "scripts" / "build_estimates.py")], check=True)
    args.draft.unlink()
    print(f"Added {len(added)}: {added}. Skipped {len(skipped)} already covered: {skipped}. Deploy the backend to use them.")


if __name__ == "__main__":
    main()
