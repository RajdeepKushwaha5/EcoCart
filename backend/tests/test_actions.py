import pytest

import actions
from conftest import FakeTable
from responses import ApiError
from sessions import create_session, session_id_from_event

CATALOG = [{"modelId": "a55", "displayName": "Galaxy A55 5G"}]
OPTIONS = [{"city": "delhi-ncr", "optionId": "recycler-1", "name": "Recycler One"}]
BODY = {"modelIdBought": "a55", "oldDevice": {"brand": "Xiaomi", "ageYears": 4}, "optionId": "recycler-1"}


@pytest.fixture
def table():
    return FakeTable(["sessionId", "actionId"])


def test_session_token_round_trip():
    sessions = FakeTable(["tokenHash"])
    token = create_session(sessions)
    stored = next(iter(sessions.items.values()))
    assert token not in stored.values()
    event = {"headers": {"authorization": f"Bearer {token}"}}
    assert session_id_from_event(event, sessions) == stored["sessionId"]


def test_bad_token_is_rejected():
    sessions = FakeTable(["tokenHash"])
    create_session(sessions)
    with pytest.raises(ApiError) as error:
        session_id_from_event({"headers": {"authorization": "Bearer guess"}}, sessions)
    assert error.value.status == 401


def test_create_list_update_delete(table):
    created = actions.create_action(table, "s1", BODY, CATALOG, OPTIONS)
    assert created["status"] == "planned"
    assert "sessionId" not in created

    assert [a["actionId"] for a in actions.list_actions(table, "s1")] == [created["actionId"]]

    done, change = actions.update_status(table, "s1", created["actionId"], {"status": "done"})
    assert done["status"] == "done" and "doneAt" in done
    assert change == 1
    assert actions.update_status(table, "s1", created["actionId"], {"status": "done"})[1] == 0

    assert actions.delete_action(table, "s1", created["actionId"]) is True
    assert actions.list_actions(table, "s1") == []


def test_other_session_cannot_touch_action(table):
    created = actions.create_action(table, "s1", BODY, CATALOG, OPTIONS)
    assert actions.list_actions(table, "s2") == []
    for call in (
        lambda: actions.update_status(table, "s2", created["actionId"], {"status": "done"}),
        lambda: actions.delete_action(table, "s2", created["actionId"]),
    ):
        with pytest.raises(ApiError) as error:
            call()
        assert error.value.status == 404


@pytest.mark.parametrize(
    "change",
    [
        {"modelIdBought": "unknown"},
        {"optionId": "unknown"},
        {"oldDevice": {"brand": "X", "ageYears": -1}},
        {"oldDevice": {"brand": "X", "ageYears": True}},
        {"oldDevice": {"brand": "", "ageYears": 2}},
    ],
)
def test_invalid_input_is_rejected(table, change):
    with pytest.raises(ApiError) as error:
        actions.create_action(table, "s1", {**BODY, **change}, CATALOG, OPTIONS)
    assert error.value.status == 400


def test_older_extension_field_name_still_works(table):
    body = {"modelIdBought": "a55", "oldPhone": {"brand": "Nokia", "ageYears": 6}, "optionId": "recycler-1"}
    created = actions.create_action(table, "s1", body, CATALOG, OPTIONS)
    assert created["oldDevice"] == {"brand": "Nokia", "ageYears": 6}
    assert created["category"] == "phone"
