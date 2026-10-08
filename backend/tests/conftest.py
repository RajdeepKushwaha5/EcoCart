import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend" / "src"))
sys.path.insert(0, str(ROOT / "scripts"))


class FakeTable:
    """In-memory stand-in for the DynamoDB Table methods the code uses."""

    def __init__(self, key_names):
        self.key_names = key_names
        self.items = {}

    def _key(self, item):
        return tuple(item[name] for name in self.key_names)

    def put_item(self, Item):
        self.items[self._key(Item)] = dict(Item)

    def get_item(self, Key):
        item = self.items.get(self._key(Key))
        return {"Item": dict(item)} if item else {}

    def delete_item(self, Key):
        self.items.pop(self._key(Key), None)

    def update_item(self, Key, UpdateExpression, ExpressionAttributeValues):
        # Supports the "ADD a :x, b :y" form used for counters.
        item = self.items.setdefault(self._key(Key), dict(Key))
        for part in UpdateExpression.removeprefix("ADD ").split(","):
            name, placeholder = part.split()
            item[name] = item.get(name, 0) + ExpressionAttributeValues[placeholder]

    def query(self, KeyConditionExpression, ExpressionAttributeValues, **_):
        session_id = ExpressionAttributeValues[":s"]
        return {"Items": [dict(i) for i in self.items.values() if i["sessionId"] == session_id]}
