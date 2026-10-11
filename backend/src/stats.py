"""Anonymous totals across all users, kept as counters on a single DynamoDB item."""

STATS_KEY = {"statsId": "global"}


def adjust(stats_table, saved=0, completed=0, verified=0):
    if saved == 0 and completed == 0 and verified == 0:
        return
    stats_table.update_item(
        Key=STATS_KEY,
        UpdateExpression="ADD plansSaved :saved, plansCompleted :completed, plansVerified :verified",
        ExpressionAttributeValues={":saved": saved, ":completed": completed, ":verified": verified},
    )


def read(stats_table):
    item = stats_table.get_item(Key=STATS_KEY).get("Item") or {}
    return {
        "plansSaved": max(int(item.get("plansSaved", 0)), 0),
        "plansCompleted": max(int(item.get("plansCompleted", 0)), 0),
        "plansVerified": max(int(item.get("plansVerified", 0)), 0),
    }


GAP_PREFIX = "gap#"
MAX_GAP_KEY = 400


def gap_key(crumbs):
    return GAP_PREFIX + " > ".join(" ".join(crumb.lower().split()) for crumb in crumbs)[:MAX_GAP_KEY]


def record_gap(stats_table, crumbs):
    """Count a breadcrumb that no rule matched. Only the breadcrumb is kept, never the title or who sent it."""
    if not crumbs:
        return
    stats_table.update_item(
        Key={"statsId": gap_key(crumbs)},
        UpdateExpression="ADD hits :one",
        ExpressionAttributeValues={":one": 1},
    )


REPORT_PREFIX = "report#"
REPORT_KINDS = {"price", "category", "model", "source", "other"}
SHOPS = {"amazon", "flipkart"}


def record_report(stats_table, kind, shop, listing_id):
    """Count a shopper's report that a card looks wrong. Only the kind, the shop and the public listing ID are kept."""
    key = f"{REPORT_PREFIX}{kind}#{shop}#{listing_id}"[:MAX_GAP_KEY]
    stats_table.update_item(
        Key={"statsId": key},
        UpdateExpression="ADD hits :one",
        ExpressionAttributeValues={":one": 1},
    )
