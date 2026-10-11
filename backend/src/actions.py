"""Old-device plans saved by an anonymous session."""

import secrets
import time
from datetime import datetime, timezone

from categories import CATEGORIES, device_category
from responses import ApiError, require_string

STATUSES = {"planned", "done"}
MAX_AGE_YEARS = 20
MAX_LISTING_NAME = 150
# Plenty for a household, and it stops one session from inflating the public totals.
MAX_PLANS_PER_SESSION = 50
MAX_EVIDENCE = 300
MAX_REQUEST_ID = 64


def new_action_id():
    """Time-ordered ID: millisecond timestamp plus random suffix."""
    return f"{int(time.time() * 1000):013d}-{secrets.token_hex(4)}"


def _now():
    return datetime.now(timezone.utc).isoformat()


def _public(item):
    return {key: value for key, value in item.items() if key != "sessionId"}


def validate_old_device(value):
    if not isinstance(value, dict):
        raise ApiError(400, "'oldDevice' must be an object")
    brand = require_string(value, "brand", max_length=40)
    age = value.get("ageYears")
    if not isinstance(age, int) or isinstance(age, bool) or not 0 <= age <= MAX_AGE_YEARS:
        raise ApiError(400, f"'oldDevice.ageYears' must be a whole number from 0 to {MAX_AGE_YEARS}")
    return {"brand": brand, "ageYears": age}


def _new_device(body, catalog):
    """The device being bought: a catalog model, or any listing named by the page."""
    model_id = body.get("modelIdBought")
    if model_id is not None:
        product = next((item for item in catalog if item["modelId"] == model_id), None)
        if product is None:
            raise ApiError(400, "Unknown 'modelIdBought'")
        return model_id, product["displayName"], device_category(product)

    name = require_string(body, "listingName", max_length=MAX_LISTING_NAME)
    category = body.get("category")
    if category not in CATEGORIES:
        raise ApiError(400, f"'category' must be one of {sorted(CATEGORIES)}")
    return None, name, category


def _request_id(body):
    """An ID the extension makes up for each save, so a retried request does not save the plan twice."""
    value = body.get("requestId")
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip() or len(value) > MAX_REQUEST_ID:
        raise ApiError(400, "'requestId' must be a short string")
    return value.strip()


def find_by_request(actions_table, session_id, body):
    """The plan an earlier attempt of this same request already saved, if any."""
    request_id = _request_id(body)
    if request_id is None:
        return None
    return next((item for item in list_actions(actions_table, session_id) if item.get("requestId") == request_id), None)


def create_action(actions_table, session_id, body, catalog, options):
    if len(list_actions(actions_table, session_id)) >= MAX_PLANS_PER_SESSION:
        raise ApiError(429, f"A session can keep at most {MAX_PLANS_PER_SESSION} plans")
    request_id = _request_id(body)
    model_id, model_name, category = _new_device(body, catalog)
    # "oldPhone" is what earlier versions of the extension send.
    old_device = validate_old_device(body.get("oldDevice", body.get("oldPhone")))
    option_id = require_string(body, "optionId", max_length=100)
    option = next((item for item in options if item["optionId"] == option_id), None)
    if option is None:
        raise ApiError(400, "Unknown 'optionId' for this city")

    item = {
        "sessionId": session_id,
        "actionId": new_action_id(),
        "modelIdBought": model_id,
        "modelName": model_name,
        "category": category,
        "oldDevice": old_device,
        "city": option["city"],
        "optionId": option_id,
        "optionName": option["name"],
        "status": "planned",
        "createdAt": _now(),
    }
    if request_id:
        item["requestId"] = request_id
    actions_table.put_item(Item=item)
    return _public(item)


def list_actions(actions_table, session_id):
    items = []
    kwargs = {
        "KeyConditionExpression": "sessionId = :s",
        "ExpressionAttributeValues": {":s": session_id},
    }
    while True:
        page = actions_table.query(**kwargs)
        items.extend(page["Items"])
        if "LastEvaluatedKey" not in page:
            break
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]
    return [_public(item) for item in items]


def _owned_action(actions_table, session_id, action_id):
    item = actions_table.get_item(Key={"sessionId": session_id, "actionId": action_id}).get("Item")
    if item is None:
        raise ApiError(404, "Action not found")
    return item


def update_status(actions_table, session_id, action_id, body):
    """Return (updated plan, change in completed count: -1, 0 or 1)."""
    status = body.get("status")
    if status not in STATUSES:
        raise ApiError(400, "'status' must be 'planned' or 'done'")

    item = _owned_action(actions_table, session_id, action_id)
    if item.get("verified") and status != "done":
        raise ApiError(409, "A verified handover cannot be undone")
    was_done = item["status"] == "done"
    item["status"] = status
    if status == "done":
        item["doneAt"] = _now()
    else:
        item.pop("doneAt", None)
    actions_table.put_item(Item=item)
    return _public(item), int(status == "done") - int(was_done)


def delete_action(actions_table, session_id, action_id):
    """Delete the plan and return (whether it had been marked done, whether it had been verified)."""
    item = _owned_action(actions_table, session_id, action_id)
    actions_table.delete_item(Key={"sessionId": session_id, "actionId": action_id})
    return item["status"] == "done", bool(item.get("verified"))


def request_verification(actions_table, session_id, action_id, body):
    """The shopper asks the team to verify a handover they reported, with a receipt or order reference.

    The note should name the collector and a receipt or order number, never personal details.
    """
    item = _owned_action(actions_table, session_id, action_id)
    if item["status"] != "done":
        raise ApiError(409, "Mark the plan done before asking for verification")
    if item.get("verified"):
        raise ApiError(409, "This handover is already verified")
    note = require_string(body, "note", max_length=MAX_EVIDENCE)
    item["verificationRequest"] = {"at": _now(), "note": note}
    actions_table.put_item(Item=item)
    return _public(item)


def verify(item, evidence, verified_at=None):
    """Mark a reported handover as verified by the team, from a receipt or the collector's confirmation.

    Only plans the shopper already marked done can be verified, and the evidence is kept with the plan.
    Returns the updated item; the caller stores it.
    """
    if item["status"] != "done":
        raise ApiError(409, "Only a plan marked done can be verified")
    if not isinstance(evidence, str) or not evidence.strip():
        raise ApiError(400, "Evidence is required")
    if len(evidence) > MAX_EVIDENCE:
        raise ApiError(400, "Evidence is too long")
    return {**item, "verified": {"at": verified_at or _now(), "evidence": evidence.strip()}}
