"""Validate the data files, then write them to the deployed DynamoDB tables.

Run: python scripts/seed.py --stack-name ecocart-india --region ap-south-1
Records removed from the JSON files are also removed from the tables. Products also include the models
from makers' official support lists (data/support_periods.json, see import_support_periods.py).
"""

import argparse
import json
import sys
from decimal import Decimal

import boto3

from support_catalog import full_catalog
from validate_data import DATA_DIR, check_all

TABLES = [
    ("products.json", "ProductsTableName", ["modelId"]),
    ("options.json", "OptionsTableName", ["city", "optionId"]),
    ("factors.json", "FactorsTableName", ["factorId"]),
]


def stack_outputs(stack_name, region):
    client = boto3.client("cloudformation", region_name=region)
    stack = client.describe_stacks(StackName=stack_name)["Stacks"][0]
    return {output["OutputKey"]: output["OutputValue"] for output in stack.get("Outputs", [])}


def load_decimal(name):
    with open(DATA_DIR / name, encoding="utf-8") as file:
        return json.load(file, parse_float=Decimal)


def replace_items(table, items, key_names, keep_marker=None):
    """Write the items and delete rows no longer in the file, except rows carrying keep_marker (owned by a job)."""
    wanted = {tuple(item[key] for key in key_names) for item in items}
    existing = []
    names = list(key_names) + ([keep_marker] if keep_marker else [])
    kwargs = {"ProjectionExpression": ", ".join(f"#k{i}" for i in range(len(names))),
              "ExpressionAttributeNames": {f"#k{i}": name for i, name in enumerate(names)}}
    while True:
        page = table.scan(**kwargs)
        existing.extend(page["Items"])
        if "LastEvaluatedKey" not in page:
            break
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    stale = [row for row in existing
             if tuple(row[key] for key in key_names) not in wanted and not (keep_marker and row.get(keep_marker))]
    with table.batch_writer() as batch:
        for row in stale:
            batch.delete_item(Key={key: row[key] for key in key_names})
        for item in items:
            batch.put_item(Item=item)
    return len(items), len(stale)


def keep_newer_prices(table, products):
    """The daily price job writes to the table directly. Never replace its price with an older one from the file."""
    stored = {}
    kwargs = {"ProjectionExpression": "modelId, priceInr"}
    while True:
        page = table.scan(**kwargs)
        stored.update({row["modelId"]: row.get("priceInr") for row in page["Items"]})
        if "LastEvaluatedKey" not in page:
            break
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    for product in products:
        current, ours = stored.get(product["modelId"]), product.get("priceInr")
        if current and (not ours or current["checked"] > ours["checked"]):
            product["priceInr"] = current
    return products


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--stack-name", default="ecocart-india")
    parser.add_argument("--region", default="ap-south-1")
    args = parser.parse_args()

    errors = check_all()
    if errors:
        for error in errors:
            print(f"ERROR {error}")
        sys.exit("Fix the data before seeding.")

    outputs = stack_outputs(args.stack_name, args.region)
    dynamodb = boto3.resource("dynamodb", region_name=args.region)
    for file_name, output_key, key_names in TABLES:
        table = dynamodb.Table(outputs[output_key])
        items = load_decimal(file_name)
        if file_name == "products.json":
            items = keep_newer_prices(table, full_catalog(items))
        # The weekly support-list job keeps its own rows current, so seeding leaves them alone.
        keep = "fromSupportList" if file_name == "products.json" else None
        written, removed = replace_items(table, items, key_names, keep)
        print(f"{file_name}: {written} written, {removed} removed")


if __name__ == "__main__":
    main()
