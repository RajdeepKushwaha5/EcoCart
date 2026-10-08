"""Check the deployed API end to end. Safe to run any time: it cleans up the plan it creates.

Run: python scripts/smoke_test.py https://<api-id>.execute-api.ap-south-1.amazonaws.com
Exits with status 1 if any check fails.
"""

import json
import sys
from urllib.error import HTTPError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen

CITY = "delhi-ncr"
results = []


def call(base, method, path, body=None, token=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = Request(base + path, data=data, method=method, headers=headers)
    try:
        with urlopen(request, timeout=20) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else None
    except HTTPError as error:
        raw = error.read()
        return error.code, json.loads(raw) if raw else None


def check(name, passed, detail=""):
    results.append(passed)
    print(f"{'PASS' if passed else 'FAIL'}  {name}{f'  ({detail})' if detail else ''}")
    return passed


def check_catalog(base):
    status, body = call(base, "GET", "/catalog")
    products = (body or {}).get("products", [])
    check("catalog loads", status == 200 and bool(products), f"{len(products)} phones")
    return products


def check_products(base, products):
    for product in products:
        alias = (product.get("aliases") or [product["displayName"]])[0].replace("+", " ")
        body = {"title": f"{alias} (8GB RAM, 128GB Storage)", "category": product.get("category", "phone")}
        status, match = call(base, "POST", "/match", body)
        check(f"match {product['modelId']}", status == 200 and match.get("modelId") == product["modelId"],
              match.get("matchType") if match else status)

        status, card = call(base, "GET", f"/products/{quote(product['modelId'])}?price=30000")
        facts = card.get("product", {}) if card else {}
        sourced = [key for key, value in facts.items() if isinstance(value, dict)]
        check(f"card {product['modelId']}", status == 200 and "headline" in card,
              f"sourced facts: {', '.join(sourced) or 'none'}")

    status, match = call(base, "POST", "/match", {"title": "Boat Airdopes 141 Bluetooth Earbuds"})
    check("unrelated product is not matched", status == 200 and match.get("modelId") is None)

    phone = next((p for p in products if p.get("category", "phone") == "phone"), None)
    if phone:
        alias = phone["aliases"][0].replace("+", " ")
        status, match = call(base, "POST", "/match", {"title": alias, "category": "laptop"})
        check("a phone title is not matched on a laptop page", status == 200 and match.get("modelId") is None)


def check_plans(base, products):
    status, body = call(base, "GET", "/actions")
    check("plans need a session token", status == 401)

    status, body = call(base, "GET", "/options?" + urlencode({"city": CITY}))
    options = (body or {}).get("options", [])
    if not check("verified options exist", status == 200 and bool(options), f"{len(options)} in {CITY}"):
        print("      Skipping plan checks until data/options.json has at least one verified option.")
        return

    _, first = call(base, "POST", "/sessions")
    _, second = call(base, "POST", "/sessions")
    token, other = first["token"], second["token"]

    plan = {
        "modelIdBought": products[0]["modelId"],
        "oldPhone": {"brand": "Other", "ageYears": 3},
        "city": CITY,
        "optionId": options[0]["optionId"],
    }
    status, action = call(base, "POST", "/actions", plan, token)
    if not check("save a plan", status == 201, action.get("error") if action else status):
        return
    path = f"/actions/{quote(action['actionId'])}"

    status, body = call(base, "GET", "/actions", token=token)
    check("find the saved plan", any(a["actionId"] == action["actionId"] for a in body.get("actions", [])))

    status, body = call(base, "PATCH", path, {"status": "done"}, token)
    check("mark plan done", status == 200 and body.get("status") == "done")

    status, body = call(base, "GET", "/actions", token=other)
    check("another session cannot see it", status == 200 and body.get("actions") == [])
    status, _ = call(base, "DELETE", path, token=other)
    check("another session cannot delete it", status == 404)

    status, _ = call(base, "DELETE", path, token=token)
    check("delete the plan", status == 204)

    unlisted = {"listingName": "Smoke test listing, not a real device", "category": "phone",
                "oldDevice": {"brand": "Other", "ageYears": 2}, "city": CITY, "optionId": options[0]["optionId"]}
    status, action = call(base, "POST", "/actions", unlisted, token)
    if check("plan for a device outside the catalog", status == 201, action.get("error") if action else status):
        call(base, "DELETE", f"/actions/{quote(action['actionId'])}", token=token)


def check_scorecard(base):
    status, body = call(base, "GET", "/factors")
    check("factors are public and sourced", status == 200 and all(f.get("source") for f in body.get("factors", [])) and bool(body.get("factors")))
    status, card = call(base, "GET", "/products/apple-iphone-16?price=80000")
    support = ((card or {}).get("scorecard") or {}).get("support") or {}
    check("device card has a scorecard", status == 200 and support.get("value") and support.get("count", 0) >= 3)
    lower = (card or {}).get("lowerFootprint")
    check("lower-footprint option is the same maker", lower is None or lower["displayName"].startswith("Apple"))
    status, body = call(base, "POST", "/estimate", {"title": "Cotton T-shirt", "crumbs": ["T-shirts"], "price": 499})
    rank = ((body or {}).get("estimate") or {}).get("perRupee") or {}
    check("estimate has a per-rupee position", 0 <= rank.get("position", -1) <= 1)


def check_estimates(base):
    shirt = {"title": "Cotton T-shirt", "crumbs": ["Clothing & Accessories", "Men", "T-shirts"], "price": 499}
    status, body = call(base, "POST", "/estimate", shirt)
    estimate = (body or {}).get("estimate") or {}
    check("estimate for a T-shirt", status == 200 and estimate.get("kind") == "category-estimate" and estimate.get("kg", 0) > 0,
          f"{estimate.get('kg')} kg, {estimate.get('category')}")
    check("estimate cites its dataset", (estimate.get("dataset") or {}).get("attribution") == "CEDA by Watershed")

    status, body = call(base, "POST", "/estimate", {**shirt, "price": None})
    check("no price, no number", status == 200 and body.get("estimate") is None and body.get("reason") == "no-price")
    status, body = call(base, "POST", "/estimate", {"title": "A novel", "crumbs": ["Kindle Store"], "price": 199})
    check("digital goods get no estimate", status == 200 and body.get("reason") == "excluded")


def main():
    if len(sys.argv) != 2:
        sys.exit("Usage: python scripts/smoke_test.py <ApiUrl>")
    base = sys.argv[1].rstrip("/")

    check_estimates(base)
    check_scorecard(base)
    products = check_catalog(base)
    if products:
        check_products(base, products)
        check_plans(base, products)

    failed = results.count(False)
    print(f"\n{len(results) - failed} passed, {failed} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
