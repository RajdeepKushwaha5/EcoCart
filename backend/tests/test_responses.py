import json
from decimal import Decimal

import pytest

from responses import json_response


def test_dynamodb_numbers_in_replayed_and_updated_plans_are_json_serializable():
    response = json_response(200, {"version": Decimal("2"), "oldDevice": {"ageYears": Decimal("4")},
                                   "nested": [{"value": Decimal("38.25")}]})
    assert json.loads(response["body"]) == {"version": 2, "oldDevice": {"ageYears": 4}, "nested": [{"value": 38.25}]}


def test_unexpected_objects_are_not_silently_stringified():
    with pytest.raises(TypeError):
        json_response(200, {"bad": object()})
