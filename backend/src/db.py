import os
import time
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key

CATALOG_CACHE_SECONDS = 300

_dynamodb = boto3.resource("dynamodb")
_cache = {}


def table(env_name):
    return _dynamodb.Table(os.environ[env_name])


def _scan_all(env_name):
    items = []
    kwargs = {}
    while True:
        page = table(env_name).scan(**kwargs)
        items.extend(page["Items"])
        if "LastEvaluatedKey" not in page:
            return to_plain(items)
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def _cached_scan(env_name):
    now = time.time()
    entry = _cache.get(env_name)
    if entry is None or now - entry[0] >= CATALOG_CACHE_SECONDS:
        entry = (now, _scan_all(env_name))
        _cache[env_name] = entry
    return entry[1]


def to_plain(value):
    """Convert DynamoDB Decimals into int or float so results can be JSON encoded."""
    if isinstance(value, list):
        return [to_plain(item) for item in value]
    if isinstance(value, dict):
        return {key: to_plain(item) for key, item in value.items()}
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    return value


def all_products():
    """Every catalog row, read fresh (no cache), for jobs that rewrite the catalog."""
    return _scan_all("PRODUCTS_TABLE")


def load_catalog():
    return _cached_scan("PRODUCTS_TABLE")


def load_factors():
    return _cached_scan("FACTORS_TABLE")


def options_for_city(city):
    response = table("OPTIONS_TABLE").query(KeyConditionExpression=Key("city").eq(city))
    return to_plain(response["Items"])
