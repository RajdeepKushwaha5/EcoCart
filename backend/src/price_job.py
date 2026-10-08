"""Daily job: refresh official store prices in the Products table.

Prices older than 7 days are ignored by the API, so a failure here never shows a stale price. It does make
the job fail, which raises the CloudWatch alarm, so someone can fix the price reader.
"""

import logging
from datetime import date
from decimal import Decimal

import db
from prices import refresh

logger = logging.getLogger()
logger.setLevel(logging.INFO)


class PriceRefreshError(Exception):
    pass


def handler(event, context):
    updates, failures = refresh(db.load_catalog(), date.today().isoformat())
    table = db.table("PRODUCTS_TABLE")
    for model_id, price in updates.items():
        table.update_item(
            Key={"modelId": model_id},
            UpdateExpression="SET priceInr = :price",
            ExpressionAttributeValues={":price": {**price, "value": Decimal(price["value"])}},
        )
        logger.info("Updated %s to %s", model_id, price["value"])
    if failures:
        raise PriceRefreshError(f"Could not read prices for: {failures}")
    return {"updated": sorted(updates)}
