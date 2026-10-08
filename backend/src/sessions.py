"""Anonymous sessions. The client keeps a random token; the server stores only its hash."""

import hashlib
import secrets
import uuid
from datetime import datetime, timezone

from responses import ApiError


def hash_token(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(sessions_table):
    token = secrets.token_urlsafe(32)
    sessions_table.put_item(
        Item={
            "tokenHash": hash_token(token),
            "sessionId": str(uuid.uuid4()),
            "createdAt": datetime.now(timezone.utc).isoformat(),
        }
    )
    return token


def session_id_from_event(event, sessions_table):
    header = (event.get("headers") or {}).get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise ApiError(401, "Missing session token")
    item = sessions_table.get_item(Key={"tokenHash": hash_token(token)}).get("Item")
    if item is None:
        raise ApiError(401, "Unknown session token")
    return item["sessionId"]
