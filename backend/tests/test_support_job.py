import types

import pytest

import support_job

LIST = "https://example.com/list"


def stored(model, brand, end="2031-01-01"):
    return {"modelId": model.lower().replace(" ", "-"), "brand": brand, "displayName": model, "category": "phone",
            "fromSupportList": True,
            "updatePolicy": {"value": "x", "supportEndDate": end, "source": LIST, "checked": "2026-10-01"}}


def row(model, brand, end):
    return {"brand": brand, "model": model, "category": "phone", "supportEndDate": end, "source": LIST, "checked": "2026-10-08"}


class FakeTable:
    def __init__(self):
        self.puts, self.deletes = [], []

    def batch_writer(self):
        table = self

        class Batch:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                return False

            def put_item(self, Item):
                table.puts.append(Item)

            def delete_item(self, Key):
                table.deletes.append(Key["modelId"])

        return Batch()


def run(monkeypatch, items, xiaomi_rows=None, realme_rows=None):
    table = FakeTable()
    monkeypatch.setattr(support_job, "db", types.SimpleNamespace(table=lambda name: table, all_products=lambda: items))

    def reader(rows):
        def read(checked):
            if rows is None:
                raise OSError("source down")
            return rows
        return read

    monkeypatch.setattr(support_job, "SOURCES", {"xiaomi": (reader(xiaomi_rows), {"Xiaomi", "Redmi", "POCO"}),
                                                 "realme": (reader(realme_rows), {"realme"})})
    return table, support_job.handler()


def test_adds_new_updates_changed_and_removes_ended(monkeypatch):
    items = [stored("POCO X7", "POCO"), stored("POCO M6", "POCO"), {"modelId": "curated-phone", "displayName": "Curated Phone"}]
    table, result = run(monkeypatch, items,
                        xiaomi_rows=[row("POCO X7", "POCO", "2032-01-01"), row("POCO X9", "POCO", "2033-01-01")], realme_rows=[])
    put = {item["modelId"]: item["updatePolicy"]["supportEndDate"] for item in table.puts}
    assert put == {"poco-x7": "2032-01-01", "poco-x9": "2033-01-01"}
    assert table.deletes == ["poco-m6"]
    assert "curated-phone" not in table.deletes


def test_a_source_that_is_down_keeps_its_brands(monkeypatch):
    items = [stored("POCO X7", "POCO"), stored("realme 14 Pro", "realme"), stored("OnePlus 12", "OnePlus")]
    table, result = run(monkeypatch, items, xiaomi_rows=None, realme_rows=[row("realme 16", "realme", "2032-03-01")])
    ids = {item["modelId"] for item in table.puts}
    assert {"poco-x7", "oneplus-12", "realme-16"} <= ids
    assert table.deletes == ["realme-14-pro"]
    assert result["sourcesRead"] == ["realme"]


def test_fails_loudly_when_no_source_can_be_read(monkeypatch):
    with pytest.raises(RuntimeError):
        run(monkeypatch, [stored("POCO X7", "POCO")], xiaomi_rows=None, realme_rows=None)
