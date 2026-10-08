"""List the shop breadcrumbs that no rule in data/sectors.json matched, most common first.

Add terms for the top ones to data/sectors.json, run build_estimates.py and deploy.
Run: python scripts/list_gaps.py [--top 30] [--clear]
"""

import argparse

import boto3
from boto3.dynamodb.conditions import Attr

from seed import stack_outputs

PREFIX = "gap#"


def gaps(table):
    items, kwargs = [], {"FilterExpression": Attr("statsId").begins_with(PREFIX)}
    while True:
        page = table.scan(**kwargs)
        items.extend(page["Items"])
        if "LastEvaluatedKey" not in page:
            return sorted(items, key=lambda item: -int(item.get("hits", 0)))
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--stack-name", default="ecocart-india")
    parser.add_argument("--region", default="ap-south-1")
    parser.add_argument("--top", type=int, default=30)
    parser.add_argument("--clear", action="store_true", help="Delete the listed counts after printing, once rules are added")
    args = parser.parse_args()

    name = stack_outputs(args.stack_name, args.region)["StatsTableName"]
    table = boto3.resource("dynamodb", region_name=args.region).Table(name)
    found = gaps(table)
    if not found:
        print("No unmatched breadcrumbs recorded.")
        return
    for item in found[:args.top]:
        print(f"{int(item['hits']):6}  {item['statsId'].removeprefix(PREFIX)}")
    print(f"\n{len(found)} different breadcrumbs in total.")
    if args.clear:
        with table.batch_writer() as batch:
            for item in found[:args.top]:
                batch.delete_item(Key={"statsId": item["statsId"]})
        print(f"Cleared {min(len(found), args.top)}.")


if __name__ == "__main__":
    main()
