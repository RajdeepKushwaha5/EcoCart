import json
from decimal import Decimal


def _json_number(value):
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    raise TypeError(f"Cannot encode {type(value).__name__} as JSON")


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def json_response(status, body):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body, default=_json_number),
    }


def parse_body(event):
    raw = event.get("body") or "{}"
    if event.get("isBase64Encoded"):
        raise ApiError(400, "Body must be JSON text")
    try:
        body = json.loads(raw)
    except json.JSONDecodeError:
        raise ApiError(400, "Body is not valid JSON")
    if not isinstance(body, dict):
        raise ApiError(400, "Body must be a JSON object")
    return body


def require_string(body, key, max_length=200):
    value = body.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ApiError(400, f"'{key}' is required")
    if len(value) > max_length:
        raise ApiError(400, f"'{key}' is too long")
    return value.strip()
