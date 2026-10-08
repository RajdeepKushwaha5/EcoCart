"""EcoCart's agent teams, built on the Strands Agents SDK.

  python -m ecocart_agents research --brand Apple --name "iPhone 18 Pro" --category phone
  python -m ecocart_agents map-gaps --breadcrumb "Home & Kitchen > Jars" --breadcrumb "..."
  python -m ecocart_agents map-gaps --from-gaps         (reads unmatched breadcrumbs recorded by the live API)

Add --model local:<id> to run on a model served on this machine instead of Amazon Bedrock.
Nothing reaches the catalog until a person runs scripts/approve_draft.py or scripts/approve_rules.py.
"""

import argparse
import sys
from pathlib import Path

from .models import build_model

CATEGORIES = ["phone", "laptop", "tablet", "watch", "earbuds", "tv", "appliance", "electronics"]


def recorded_gaps(top):
    """Breadcrumbs the live API could not match, most common first (see scripts/list_gaps.py)."""
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
    import boto3
    from list_gaps import PREFIX, gaps
    from seed import stack_outputs

    table = boto3.resource("dynamodb", region_name="ap-south-1").Table(stack_outputs("ecocart-india", "ap-south-1")["StatsTableName"])
    return [item["statsId"].removeprefix(PREFIX) for item in gaps(table)[:top]]


def main():
    parser = argparse.ArgumentParser(prog="ecocart_agents", description=__doc__.split("\n")[0])
    parser.add_argument("--model", help="bedrock:<id> or local:<id>; defaults to ECOCART_MODEL or Bedrock")
    commands = parser.add_subparsers(dest="command", required=True)

    research = commands.add_parser("research", help="Draft a catalog entry from official documents")
    research.add_argument("--brand", required=True)
    research.add_argument("--name", required=True, help="Model name as the maker writes it")
    research.add_argument("--category", required=True, choices=CATEGORIES)
    research.add_argument("--source", action="append", help="Skip the Source Scout and use this official URL")

    mapping = commands.add_parser("map-gaps", help="Draft category rules for breadcrumbs nothing matched")
    mapping.add_argument("--breadcrumb", action="append", default=[])
    mapping.add_argument("--from-gaps", action="store_true")
    mapping.add_argument("--top", type=int, default=20)

    args = parser.parse_args()
    model = build_model(args.model)

    if args.command == "research":
        from .catalog_team import research_device

        research_device(args.brand, args.name, args.category, model, args.source)
        print("Review the draft, then run: python scripts/approve_draft.py drafts/<file>.json")
    else:
        from .category_team import map_gaps

        breadcrumbs = args.breadcrumb + (recorded_gaps(args.top) if args.from_gaps else [])
        if not breadcrumbs:
            sys.exit("Give --breadcrumb or --from-gaps.")
        path, rules = map_gaps(breadcrumbs, model)
        print(f"{len(rules)} rule(s) drafted in {path.name}. Review, then run: python scripts/approve_rules.py drafts/{path.name}")


if __name__ == "__main__":
    main()
