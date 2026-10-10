"""Mark a reported old-device handover as verified, after the team has seen proof that it happened.

Proof is a collection receipt, or the collector confirming the handover in writing. Record what was seen, never
personal details: for example "Cashify pickup receipt seen, 11 Oct 2026". The plan ID is shown on each plan in the
shopper's dashboard, under My actions.

Run: python scripts/verify_handover.py --action-id <id> --evidence "<what was seen>" [--undo]
"""

import argparse
import sys
from pathlib import Path

import boto3
from boto3.dynamodb.conditions import Attr

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend" / "src"))

import actions  # noqa: E402
import stats  # noqa: E402
from responses import ApiError  # noqa: E402


def table_names(stack_name, region):
    client = boto3.client("cloudformation", region_name=region)
    resources = client.describe_stack_resources(StackName=stack_name)["StackResources"]
    return {resource["LogicalResourceId"]: resource["PhysicalResourceId"] for resource in resources}


def find_action(table, action_id):
    kwargs = {"FilterExpression": Attr("actionId").eq(action_id)}
    while True:
        page = table.scan(**kwargs)
        if page["Items"]:
            return page["Items"][0]
        if "LastEvaluatedKey" not in page:
            return None
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--action-id", required=True)
    parser.add_argument("--evidence", help="What the team saw, without personal details")
    parser.add_argument("--undo", action="store_true", help="Remove a verification recorded by mistake")
    parser.add_argument("--stack-name", default="ecocart-india")
    parser.add_argument("--region", default="ap-south-1")
    args = parser.parse_args()

    names = table_names(args.stack_name, args.region)
    dynamodb = boto3.resource("dynamodb", region_name=args.region)
    actions_table = dynamodb.Table(names["ActionsTable"])
    stats_table = dynamodb.Table(names["StatsTable"])

    item = find_action(actions_table, args.action_id)
    if item is None:
        sys.exit(f"No plan with action ID {args.action_id}")

    if args.undo:
        if not item.get("verified"):
            sys.exit("That plan is not verified.")
        item.pop("verified")
        actions_table.put_item(Item=item)
        stats.adjust(stats_table, verified=-1)
        print(f"Removed the verification from {args.action_id}.")
        return

    if item.get("verified"):
        sys.exit(f"Already verified on {item['verified']['at']}: {item['verified']['evidence']}")
    try:
        updated = actions.verify(item, args.evidence or "")
    except ApiError as error:
        sys.exit(error.message)
    actions_table.put_item(Item=updated)
    stats.adjust(stats_table, verified=1)
    print(f"Verified {args.action_id} ({item['optionName']}, {item['city']}): {updated['verified']['evidence']}")


if __name__ == "__main__":
    main()
