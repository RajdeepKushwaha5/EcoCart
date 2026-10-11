import json
import sys
import types

import pytest

from conftest import FakeTable

SRC = "https://example.com"
CATALOG = [{
    "modelId": "a55", "brand": "Samsung", "displayName": "Galaxy A55 5G", "aliases": ["Galaxy A55"],
    "updatePolicy": {"value": "Six years", "supportEndDate": "2030-03", "source": SRC, "checked": "2026-10-01"},
    "repairability": {"value": "8/10", "source": None, "checked": None},
}]
OPTIONS = [
    {"city": "delhi-ncr", "optionId": "any", "name": "Any brand", "brands": [], "source": SRC, "checked": "2026-10-01"},
    {"city": "delhi-ncr", "optionId": "laptops", "name": "Laptops only", "brands": [], "categories": ["laptop"],
     "source": SRC, "checked": "2026-10-01"},
    {"city": "delhi-ncr", "optionId": "apple", "name": "Apple only", "brands": ["Apple"], "source": SRC, "checked": "2026-10-01"},
    {"city": "delhi-ncr", "optionId": "unsourced", "name": "No source", "brands": []},
]


@pytest.fixture
def app(monkeypatch):
    tables = {
        "SESSIONS_TABLE": FakeTable(["tokenHash"]),
        "ACTIONS_TABLE": FakeTable(["sessionId", "actionId"]),
        "STATS_TABLE": FakeTable(["statsId"]),
    }
    fake_db = types.SimpleNamespace(
        load_catalog=lambda: CATALOG,
        load_factors=lambda: [],
        options_for_city=lambda city: [o for o in OPTIONS if o["city"] == city],
        table=lambda name: tables[name],
        to_plain=lambda value: value,
    )
    monkeypatch.setitem(sys.modules, "db", fake_db)
    monkeypatch.delenv("BEDROCK_MODEL_ID", raising=False)
    sys.modules.pop("app", None)
    import app as module
    return module


def call(app, route, body=None, token=None, path=None, query=None):
    event = {
        "routeKey": route,
        "body": None if body is None else json.dumps(body),
        "headers": {"authorization": f"Bearer {token}"} if token else {},
        "pathParameters": path,
        "queryStringParameters": query,
    }
    response = app.handler(event, None)
    return response["statusCode"], json.loads(response["body"]) if "body" in response else None


def test_unknown_route(app):
    assert call(app, "GET /nope")[0] == 404


def test_match_and_product(app):
    status, result = call(app, "POST /match", {"title": "Samsung Galaxy A55 5G"})
    assert status == 200 and result["modelId"] == "a55"

    status, card = call(app, "GET /products/{modelId}", path={"modelId": "a55"}, query={"price": "30000"})
    assert status == 200
    assert card["headline"] == {
        "label": "Security updates until at least", "value": "March 2030", "source": SRC,
        "derived": False, "startSource": None,
    }
    assert card["product"]["repairability"] is None
    assert card["explanationSource"] == "template"


def test_catalog_lists_badges(app):
    status, result = call(app, "GET /catalog")
    assert status == 200
    assert result["products"] == [{
        "modelId": "a55", "displayName": "Galaxy A55 5G", "category": "phone", "aliases": ["Galaxy A55"],
        "excludes": [], "badge": "Updates till at least Mar 2030",
    }]


def test_bad_input_returns_400(app):
    assert call(app, "POST /match", {"title": ""})[0] == 400
    assert call(app, "GET /products/{modelId}", path={"modelId": "a55"}, query={"price": "abc"})[0] == 400
    assert call(app, "GET /options")[0] == 400


def test_options_hide_unsourced_and_filter_brand(app):
    status, result = call(app, "GET /options", query={"city": "delhi-ncr", "brand": "samsung"})
    assert status == 200
    assert [o["optionId"] for o in result["options"]] == ["any", "laptops"]


def test_actions_need_token_and_are_scoped(app):
    assert call(app, "GET /actions")[0] == 401

    _, session = call(app, "POST /sessions")
    body = {"modelIdBought": "a55", "oldPhone": {"brand": "Xiaomi", "ageYears": 3}, "optionId": "any", "city": "delhi-ncr"}
    status, action = call(app, "POST /actions", body, token=session["token"])
    assert status == 201

    _, other = call(app, "POST /sessions")
    assert call(app, "GET /actions", token=other["token"])[1] == {"actions": []}
    path = {"actionId": action["actionId"]}
    assert call(app, "DELETE /actions/{actionId}", token=other["token"], path=path)[0] == 404
    assert call(app, "DELETE /actions/{actionId}", token=session["token"], path=path)[0] == 204


def test_public_totals_follow_plans(app):
    assert call(app, "GET /stats")[1] == {"plansSaved": 0, "plansCompleted": 0, "plansVerified": 0, "devicesCovered": 1}

    _, session = call(app, "POST /sessions")
    token = session["token"]
    body = {"modelIdBought": "a55", "oldPhone": {"brand": "Xiaomi", "ageYears": 3}, "optionId": "any", "city": "delhi-ncr"}
    _, action = call(app, "POST /actions", body, token=token)
    path = {"actionId": action["actionId"]}
    call(app, "PATCH /actions/{actionId}", {"status": "done"}, token=token, path=path)
    assert call(app, "GET /stats")[1] == {"plansSaved": 1, "plansCompleted": 1, "plansVerified": 0, "devicesCovered": 1}

    call(app, "DELETE /actions/{actionId}", token=token, path=path)
    assert call(app, "GET /stats")[1] == {"plansSaved": 0, "plansCompleted": 0, "plansVerified": 0, "devicesCovered": 1}


def test_only_public_routes_allow_other_origins(app):
    stats = app.handler({"routeKey": "GET /stats"}, None)
    assert stats["headers"]["Access-Control-Allow-Origin"] == "*"
    catalog = app.handler({"routeKey": "GET /catalog"}, None)
    assert "Access-Control-Allow-Origin" not in catalog["headers"]


def test_options_filter_by_category(app):
    phone = call(app, "GET /options", query={"city": "delhi-ncr", "category": "phone"})[1]["options"]
    laptop = call(app, "GET /options", query={"city": "delhi-ncr", "category": "laptop"})[1]["options"]
    assert [o["optionId"] for o in phone] == ["any", "apple"]
    assert [o["optionId"] for o in laptop] == ["any", "laptops", "apple"]
    assert call(app, "GET /options", query={"city": "delhi-ncr", "category": "fridge"})[0] == 400


def test_match_is_limited_to_the_page_category(app):
    assert call(app, "POST /match", {"title": "Samsung Galaxy A55 5G", "category": "phone"})[1]["modelId"] == "a55"
    assert call(app, "POST /match", {"title": "Samsung Galaxy A55 5G", "category": "laptop"})[1]["modelId"] is None


def test_plan_for_a_device_outside_the_catalog(app):
    _, session = call(app, "POST /sessions")
    body = {"listingName": "Redmi Note 15 Pro (8GB, 256GB)", "category": "phone",
            "oldDevice": {"brand": "Xiaomi", "ageYears": 4}, "optionId": "any", "city": "delhi-ncr"}
    status, action = call(app, "POST /actions", body, token=session["token"])
    assert status == 201
    assert action["modelIdBought"] is None
    assert action["modelName"] == "Redmi Note 15 Pro (8GB, 256GB)"
    assert action["category"] == "phone"
    assert action["oldDevice"] == {"brand": "Xiaomi", "ageYears": 4}

    missing_category = {**body, "category": None}
    assert call(app, "POST /actions", missing_category, token=session["token"])[0] == 400


def test_estimate_route(app):
    body = {"title": "Cotton T-shirt", "crumbs": ["Clothing & Accessories", "T-shirts"], "price": 499}
    status, result = call(app, "POST /estimate", body)
    assert status == 200
    assert result["estimate"]["category"] == "Clothing"
    assert result["estimate"]["kg"] > 0
    assert result["estimate"]["equivalents"] == []


def test_estimate_rejects_bad_input(app):
    assert call(app, "POST /estimate", {"title": "Shirt", "crumbs": "Clothing"})[0] == 400
    assert call(app, "POST /estimate", {"title": "Shirt", "price": "499"})[0] == 400


def test_unmatched_breadcrumb_is_counted_without_the_title(app):
    body = {"title": "A private title", "crumbs": ["Mystery Things", "Odd Stuff"], "price": 300}
    call(app, "POST /estimate", body)
    call(app, "POST /estimate", body)
    call(app, "POST /estimate", {"title": "Shirt", "crumbs": ["Clothing & Accessories"], "price": 300})
    gaps = app.db.table("STATS_TABLE").items
    assert gaps == {("gap#mystery things > odd stuff",): {"statsId": "gap#mystery things > odd stuff", "hits": 2}}


def test_a_retried_save_is_stored_and_counted_once(app):
    _, session = call(app, "POST /sessions")
    body = {"modelIdBought": "a55", "oldPhone": {"brand": "Xiaomi", "ageYears": 3}, "optionId": "any", "city": "delhi-ncr",
            "requestId": "retry-me"}
    first_status, first = call(app, "POST /actions", body, token=session["token"])
    again_status, again = call(app, "POST /actions", body, token=session["token"])
    assert (first_status, again_status) == (201, 200)
    assert again["actionId"] == first["actionId"]
    assert call(app, "GET /stats")[1]["plansSaved"] == 1


def test_verification_request_route(app):
    _, session = call(app, "POST /sessions")
    token = session["token"]
    body = {"modelIdBought": "a55", "oldPhone": {"brand": "Xiaomi", "ageYears": 3}, "optionId": "any", "city": "delhi-ncr"}
    _, action = call(app, "POST /actions", body, token=token)
    path = {"actionId": action["actionId"]}
    assert call(app, "POST /actions/{actionId}/verification", {"note": "Receipt 9"}, token=token, path=path)[0] == 409
    call(app, "PATCH /actions/{actionId}", {"status": "done"}, token=token, path=path)
    status, item = call(app, "POST /actions/{actionId}/verification", {"note": "Receipt 9"}, token=token, path=path)
    assert status == 200 and item["verificationRequest"]["note"] == "Receipt 9"


def test_reports_keep_only_the_kind_shop_and_listing(app):
    assert call(app, "POST /reports", {"kind": "price", "shop": "amazon", "listingId": "B0DYDPBM8K"})[0] == 204
    assert call(app, "POST /reports", {"kind": "price", "shop": "amazon", "listingId": "B0DYDPBM8K"})[0] == 204
    stats_table = app.db.table("STATS_TABLE")
    assert stats_table.items[("report#price#amazon#B0DYDPBM8K",)]["hits"] == 2
    for bad in ({"kind": "rude", "shop": "amazon", "listingId": "B0DYDPBM8K"},
                {"kind": "price", "shop": "ebay", "listingId": "B0DYDPBM8K"},
                {"kind": "price", "shop": "amazon", "listingId": "<script>"}):
        assert call(app, "POST /reports", bad)[0] == 400


def test_search_results_get_estimates_from_their_titles(app):
    items = [{"title": "Tata Tea Premium 1 kg", "price": 487}, {"title": "Mystery thing", "price": 100}, {"title": "", "price": 5},
             {"title": "Cotton T-shirt for men", "price": "free"}]
    status, body = call(app, "POST /estimates", {"items": items})
    assert status == 200
    assert len(body["results"]) == 4
    assert body["results"][2] is None
    assert body["results"][3] is None  # no usable price, so no number
    assert call(app, "POST /estimates", {"items": []})[0] == 400
    assert call(app, "POST /estimates", {"items": [{"title": "x"}] * 61})[0] == 400
    assert app.db.table("STATS_TABLE").items == {}
