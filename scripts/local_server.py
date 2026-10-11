"""Run the API on your machine for development, without AWS.

Uses the same Lambda handler as the deployed backend. Products and options are read
from the data/ folder on every request, so edits show up after a page refresh.
Sessions and saved plans live in memory and are lost when the server stops.

Run: python scripts/local_server.py
Then set API_BASE_URL in extension/config.js to http://localhost:3000
"""

import json
import re
import sys
import types
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit

from support_catalog import full_catalog

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
PORT = 3000


class MemoryTable:
    """The few DynamoDB Table methods the handler uses, kept in a dict."""

    def __init__(self, key_names):
        self.key_names = key_names
        self.items = {}
        self.meta = types.SimpleNamespace(client=types.SimpleNamespace(exceptions=types.SimpleNamespace(ConditionalCheckFailedException=ConditionalFailure)))

    def _key(self, item):
        return tuple(item[name] for name in self.key_names)

    def _condition(self, key, expression, values):
        item = self.items.get(key)
        if not expression:
            return
        if expression == "attribute_not_exists(actionId)":
            valid = item is None
        elif expression == "version = :version":
            valid = item is not None and item.get("version") == values[":version"]
        else:
            valid = item is not None and "version" not in item
        if not valid:
            raise ConditionalFailure()

    def put_item(self, Item, ConditionExpression=None, ExpressionAttributeValues=None):
        self._condition(self._key(Item), ConditionExpression, ExpressionAttributeValues)
        self.items[self._key(Item)] = json.loads(json.dumps(Item))

    def get_item(self, Key, **_):
        item = self.items.get(self._key(Key))
        return {"Item": json.loads(json.dumps(item))} if item else {}

    def delete_item(self, Key, ConditionExpression=None, ExpressionAttributeValues=None):
        self._condition(self._key(Key), ConditionExpression, ExpressionAttributeValues)
        self.items.pop(self._key(Key), None)

    def update_item(self, Key, UpdateExpression, ExpressionAttributeValues):
        # Supports the "ADD a :x, b :y" form used for counters.
        item = self.items.setdefault(self._key(Key), dict(Key))
        for part in UpdateExpression.removeprefix("ADD ").split(","):
            name, placeholder = part.split()
            item[name] = item.get(name, 0) + ExpressionAttributeValues[placeholder]

    def query(self, KeyConditionExpression, ExpressionAttributeValues, **_):
        session_id = ExpressionAttributeValues[":s"]
        return {"Items": [dict(item) for item in self.items.values() if item["sessionId"] == session_id]}


class ConditionalFailure(Exception):
    pass


def read_json(name):
    with open(DATA_DIR / name, encoding="utf-8") as file:
        return json.load(file)


def install_local_db():
    tables = {
        "SESSIONS_TABLE": MemoryTable(["tokenHash"]),
        "ACTIONS_TABLE": MemoryTable(["sessionId", "actionId"]),
        "STATS_TABLE": MemoryTable(["statsId"]),
    }
    sys.modules["db"] = types.SimpleNamespace(
        load_catalog=lambda: full_catalog(read_json("products.json")),
        load_factors=lambda: read_json("factors.json"),
        options_for_city=lambda city: [o for o in read_json("options.json") if o.get("city") == city],
        table=lambda name: tables[name],
        to_plain=lambda value: value,
    )


install_local_db()
sys.path.insert(0, str(ROOT / "backend" / "src"))
import app  # noqa: E402  (must load after the local db module is installed)


def route_patterns():
    patterns = []
    for route_key in app.ROUTES:
        method, path = route_key.split(" ", 1)
        regex = "^" + re.sub(r"\{(\w+)\}", r"(?P<\1>[^/]+)", path) + "$"
        patterns.append((method, re.compile(regex), route_key))
    return patterns


ROUTE_PATTERNS = route_patterns()


def build_event(method, raw_path, headers, body):
    url = urlsplit(raw_path)
    for route_method, regex, route_key in ROUTE_PATTERNS:
        found = regex.match(url.path)
        if route_method == method and found:
            return {
                "routeKey": route_key,
                "pathParameters": found.groupdict() or None,
                "queryStringParameters": dict(parse_qsl(url.query)) or None,
                "headers": {key.lower(): value for key, value in headers.items()},
                "body": body,
            }
    return {"routeKey": f"{method} {url.path}"}


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, body=b"", content_type="application/json"):
        self.send_response(status)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        if body:
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_OPTIONS(self):
        self._send(204)

    def _handle(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length).decode("utf-8") if length else None
        event = build_event(self.command, self.path, dict(self.headers), body)
        response = app.handler(event, None)
        self._send(response["statusCode"], response.get("body", "").encode("utf-8"))

    do_GET = do_POST = do_PATCH = do_DELETE = _handle


class Server(ThreadingHTTPServer):
    # On Windows, address reuse lets a second copy bind the same port without an error,
    # and requests then reach whichever copy started first.
    allow_reuse_address = False


if __name__ == "__main__":
    try:
        server = Server(("127.0.0.1", PORT), Handler)
    except OSError:
        sys.exit(f"Port {PORT} is already in use. Stop the other server first.")
    print(f"EcoCart local API on http://localhost:{PORT}  (Ctrl+C to stop)")
    server.serve_forever()
