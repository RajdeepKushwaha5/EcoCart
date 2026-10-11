"""Collect Amazon.in's category tree from its public Best Sellers pages, and list the paths EcoCart has no rule for.

Each Best Sellers page names its subcategories, so a breadth-first walk gives category paths such as
"Home & Kitchen > Kitchen & Home Appliances > Small Kitchen Appliances". These are the same names that appear in
product breadcrumbs. Paths that no rule in data/sectors.json matches are written out, for the category team in
agents/ to draft rules from, and for a person to approve.

Run: python scripts/collect_categories.py [--depth 3] [--max-pages 700]
Writes research/amazon-categories.json (all paths) and research/unmatched-categories.json (paths with no rule).
"""

import argparse
import html
import json
import re
import sys
import time
import urllib.request
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend" / "src"))

from estimate import sector_from_crumbs  # noqa: E402

START = "https://www.amazon.in/gp/bestsellers/"
LINK = re.compile(r'href="(/gp/bestsellers/[^"]+?/ref=zg_bs_nav_[^"]*?_(\d+)[^"]*)"[^>]*>([^<]+)<')
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
    "Accept-Language": "en-IN,en;q=0.9",
}
# Departments with nothing physical to estimate.
SKIP = {"amazon launchpad", "amazon renewed", "apps & games", "books", "kindle store", "gift cards", "movies & tv shows",
        "music", "software", "video games", "subscribe & save"}
PAUSE_SECONDS = 1.0


def fetch(url):
    request = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read().decode("utf-8", errors="replace")


def children(page_html, depth):
    """Subcategory links one level below the page, as (name, url)."""
    found = []
    for href, link_depth, name in LINK.findall(page_html):
        if int(link_depth) == depth:
            found.append((html.unescape(name).strip(), "https://www.amazon.in" + href.split("/ref=")[0]))
    return found


def crawl(max_depth, max_pages):
    paths, queue, seen, pages = [], deque([((), START, 0)]), {START}, 0
    while queue and pages < max_pages:
        path, url, depth = queue.popleft()
        try:
            page = fetch(url)
        except Exception as error:  # A page that fails is skipped; the walk goes on.
            print(f"  skipped {url}: {error}", file=sys.stderr)
            continue
        pages += 1
        for name, child_url in children(page, depth):
            if not path and name.lower() in SKIP:
                continue
            child = path + (name,)
            paths.append(list(child))
            if depth + 1 < max_depth and child_url not in seen:
                seen.add(child_url)
                queue.append((child, child_url, depth + 1))
        if pages % 25 == 0:
            print(f"{pages} pages, {len(paths)} paths", file=sys.stderr)
        time.sleep(PAUSE_SECONDS)
    return paths


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--depth", type=int, default=3)
    parser.add_argument("--max-pages", type=int, default=700)
    args = parser.parse_args()

    paths = crawl(args.depth, args.max_pages)
    unique = list({" > ".join(path): path for path in paths}.values())
    unmatched = [path for path in unique if sector_from_crumbs(path, "") is None]
    out = ROOT / "research"
    out.mkdir(exist_ok=True)
    (out / "amazon-categories.json").write_text(json.dumps(unique, indent=1, ensure_ascii=False), encoding="utf-8")
    (out / "unmatched-categories.json").write_text(json.dumps(unmatched, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"{len(unique)} category paths, {len(unique) - len(unmatched)} matched by a rule, {len(unmatched)} not matched.")


if __name__ == "__main__":
    main()
