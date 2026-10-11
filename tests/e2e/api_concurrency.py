"""Check retry and edit safety against a deployed API, using a disposable session."""

import argparse
import json
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor


def request(base, method, path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read())


def check(base):
    status, session = request(base, "POST", "/sessions")
    assert status == 201, "Could not create test session"
    token = session["token"]
    try:
        status, routes = request(base, "GET", "/options?city=delhi-ncr&brand=Xiaomi&category=phone")
        assert status == 200 and routes["options"], "No route for the test device"
        body = {"listingName": "EcoCart concurrency test", "category": "phone", "city": "delhi-ncr",
                "oldDevice": {"brand": "Xiaomi", "ageYears": 4}, "optionId": routes["options"][0]["optionId"],
                "requestId": f"concurrency-{uuid.uuid4().hex}"}
        with ThreadPoolExecutor(max_workers=5) as pool:
            results = list(pool.map(lambda _: request(base, "POST", "/actions", body, token), range(5)))
        assert all(code in (200, 201) for code, _ in results), f"Save statuses: {[code for code, _ in results]}"
        ids = {item["actionId"] for _, item in results}
        assert len(ids) == 1, "Retries created duplicate plans"
        status, plans = request(base, "GET", "/actions", token=token)
        assert status == 200 and len(plans["actions"]) == 1
        action_id = next(iter(ids))
        print("PASS five concurrent saves produce one plan")
        with ThreadPoolExecutor(max_workers=2) as pool:
            edits = list(pool.map(lambda _: request(base, "PATCH", f"/actions/{action_id}", {"status": "done"}, token), range(2)))
        assert all(code in (200, 409) for code, _ in edits), f"Edit statuses: {[code for code, _ in edits]}"
        status, plans = request(base, "GET", "/actions", token=token)
        assert status == 200 and plans["actions"][0]["status"] == "done"
        print("PASS concurrent updates complete or return a conflict")
    finally:
        status, plans = request(base, "GET", "/actions", token=token)
        if status != 200:
            raise RuntimeError("Could not list temporary plans for cleanup")
        for plan in plans["actions"]:
            status, _ = request(base, "DELETE", f"/actions/{plan['actionId']}", token=token)
            if status != 204:
                raise RuntimeError("Could not delete a temporary plan")
        print("PASS temporary plans removed")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("api_url")
    args = parser.parse_args()
    check(args.api_url.rstrip("/"))


if __name__ == "__main__":
    main()
