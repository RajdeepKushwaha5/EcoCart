"""Lambda entry point for the EcoCart HTTP API."""

import logging
from datetime import date

import actions
import db
import stats
from carbon import round_significant, usable_factors
from categories import CATEGORIES, in_category
from estimate import estimate
from match import match_listing
from products import catalog_entry, product_card
from responses import ApiError, json_response, parse_body, require_string
from sessions import create_session, session_id_from_event

logger = logging.getLogger()
logger.setLevel(logging.INFO)

MAX_DETAILS = 60
MAX_DETAIL_LENGTH = 300
MAX_CRUMBS = 10


def _query(event):
    return event.get("queryStringParameters") or {}


def _path_param(event, name):
    return (event.get("pathParameters") or {}).get(name, "")


def _page_price(event):
    raw = _query(event).get("price")
    if raw is None:
        return None
    try:
        price = float(raw)
    except ValueError:
        raise ApiError(400, "'price' must be a number")
    return price if price > 0 else None


def _clean_details(value):
    if value is None:
        return {}
    if not isinstance(value, dict):
        raise ApiError(400, "'details' must be an object")
    cleaned = {}
    for key, text in list(value.items())[:MAX_DETAILS]:
        if isinstance(key, str) and isinstance(text, str):
            cleaned[key[:MAX_DETAIL_LENGTH]] = text[:MAX_DETAIL_LENGTH]
    return cleaned


def _category(value):
    if value is None:
        return None
    if value not in CATEGORIES:
        raise ApiError(400, f"'category' must be one of {sorted(CATEGORIES)}")
    return value


def _accepts(values, wanted):
    """An empty list on an option means it accepts anything."""
    return not values or wanted.lower() in (value.lower() for value in values)


def _options(city, brand=None, category=None):
    options = [option for option in db.options_for_city(city) if option.get("source") and option.get("checked")]
    if brand:
        options = [option for option in options if _accepts(option.get("brands"), brand)]
    if category:
        options = [option for option in options if _accepts(option.get("categories"), category)]
    return options


def match(event):
    body = parse_body(event)
    title = require_string(body, "title", max_length=500)
    catalog = in_category(db.load_catalog(), _category(body.get("category")))
    return 200, match_listing(title, _clean_details(body.get("details")), catalog)


def _clean_crumbs(value):
    if value is None:
        return []
    if not isinstance(value, list):
        raise ApiError(400, "'crumbs' must be a list")
    return [crumb[:100] for crumb in value[:MAX_CRUMBS] if isinstance(crumb, str) and crumb.strip()]


def _body_price(body):
    price = body.get("price")
    if price is None:
        return None
    if isinstance(price, bool) or not isinstance(price, (int, float)):
        raise ApiError(400, "'price' must be a number")
    return price


def post_estimate(event):
    body = parse_body(event)
    title = require_string(body, "title", max_length=500)
    crumbs = _clean_crumbs(body.get("crumbs"))
    result = estimate(crumbs, title, _body_price(body))
    if result.get("reason") == "unclassified" or (result["estimate"] or {}).get("classifiedBy") in ("model", "title"):
        _record_gap(crumbs)
    if result["estimate"]:
        kg = result["estimate"]["kg"]
        result["estimate"]["equivalents"] = [
            {"amount": round_significant(kg / factor["kgCo2ePerUnit"]), "unit": factor["unit"], "source": factor["source"]}
            for factor in usable_factors(db.load_factors())
        ]
    return 200, result


def get_product(event):
    catalog = db.load_catalog()
    model_id = _path_param(event, "modelId")
    product = next((item for item in catalog if item["modelId"] == model_id), None)
    if product is None:
        raise ApiError(404, "Unknown model")
    return 200, product_card(product, _page_price(event), catalog, db.load_factors(), date.today())


def get_catalog(event):
    return 200, {"products": [catalog_entry(product) for product in db.load_catalog()]}


def list_options(event):
    query = _query(event)
    city = query.get("city")
    if not city:
        raise ApiError(400, "'city' is required")
    return 200, {"options": _options(city, query.get("brand"), _category(query.get("category")))}


def post_session(event):
    return 201, {"token": create_session(db.table("SESSIONS_TABLE"))}


def _count(saved=0, completed=0):
    # The totals are a nice-to-have; a failed update must never fail the user's request.
    try:
        stats.adjust(db.table("STATS_TABLE"), saved, completed)
    except Exception:
        logger.exception("Could not update the public totals")


def _record_gap(crumbs):
    # Shows which shop categories need a rule. Like the totals, it must never fail the request.
    try:
        stats.record_gap(db.table("STATS_TABLE"), crumbs)
    except Exception:
        logger.exception("Could not record an unmatched breadcrumb")


def post_action(event):
    session_id = session_id_from_event(event, db.table("SESSIONS_TABLE"))
    body = parse_body(event)
    city = require_string(body, "city", max_length=60)
    item = actions.create_action(
        db.table("ACTIONS_TABLE"), session_id, body, db.load_catalog(), _options(city, category=None)
    )
    _count(saved=1)
    return 201, item


def get_actions(event):
    session_id = session_id_from_event(event, db.table("SESSIONS_TABLE"))
    items = actions.list_actions(db.table("ACTIONS_TABLE"), session_id)
    return 200, {"actions": db.to_plain(items)}


def patch_action(event):
    session_id = session_id_from_event(event, db.table("SESSIONS_TABLE"))
    item, completed_change = actions.update_status(
        db.table("ACTIONS_TABLE"), session_id, _path_param(event, "actionId"), parse_body(event)
    )
    _count(completed=completed_change)
    return 200, db.to_plain(item)


def delete_action(event):
    session_id = session_id_from_event(event, db.table("SESSIONS_TABLE"))
    was_done = actions.delete_action(db.table("ACTIONS_TABLE"), session_id, _path_param(event, "actionId"))
    _count(saved=-1, completed=-int(was_done))
    return 204, None


def get_factors(event):
    """Sourced conversion factors, for figures the extension works out in the browser (an appliance's yearly use)."""
    return 200, {"factors": usable_factors(db.load_factors())}


def get_stats(event):
    return 200, {**stats.read(db.table("STATS_TABLE")), "devicesCovered": len(db.load_catalog())}


ROUTES = {
    "POST /match": match,
    "POST /estimate": post_estimate,
    "GET /products/{modelId}": get_product,
    "GET /catalog": get_catalog,
    "GET /stats": get_stats,
    "GET /factors": get_factors,
    "GET /options": list_options,
    "POST /sessions": post_session,
    "POST /actions": post_action,
    "GET /actions": get_actions,
    "PATCH /actions/{actionId}": patch_action,
    "DELETE /actions/{actionId}": delete_action,
}


# Public, anonymous data that the website reads from another origin.
PUBLIC_ROUTES = {"GET /stats"}


def _route(event):
    route = ROUTES.get(event.get("routeKey"))
    if route is None:
        return json_response(404, {"error": "Not found"})
    try:
        status, body = route(event)
    except ApiError as error:
        return json_response(error.status, {"error": error.message})
    except Exception:
        logger.exception("Unhandled error on %s", event.get("routeKey"))
        return json_response(500, {"error": "Internal error"})
    if body is None:
        return {"statusCode": status}
    return json_response(status, body)


def handler(event, context):
    response = _route(event)
    if event.get("routeKey") in PUBLIC_ROUTES:
        response.setdefault("headers", {})["Access-Control-Allow-Origin"] = "*"
    return response
