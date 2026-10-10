// Run: node --test extension/tests/routing.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../content/main.js"), "utf8");

function routeHarness(initialPage) {
  let page = initialPage;
  let tick;
  const rendered = [];
  const reads = { count: 0 };
  const context = {
    SITE: {
      listingId: () => "ITM123",
      readProductPage: () => { reads.count += 1; return page; },
      quickProductState: () => JSON.stringify([page?.title, page?.price]),
    },
    location: { pathname: "/item/p/itm123", search: "?pid=ITM123" },
    READY_ATTEMPTS: 8,
    runProductPage: (attempt, readPage) => {
      if (!readPage || (!readPage.crumbs.length && attempt < 7)) return false;
      rendered.push(readPage);
      return true;
    },
    keepCardAttached: () => {},
    setInterval: (fn) => { tick = fn; },
    document: { getElementById: () => null },
    CARD_ID: "ecocart-card",
    cardHost: null,
    productRunId: 0,
  };
  vm.runInNewContext(source, context);
  return { tick: () => tick(), setPage: (value) => { page = value; }, rendered, reads, context };
}

test("keeps trying when a shop renders its product late", () => {
  const app = routeHarness(null);
  for (let i = 0; i < 12; i += 1) app.tick();
  assert.equal(app.rendered.length, 0);
  app.setPage({ title: "Cotton shirt", price: 499, crumbs: ["T-shirts"], details: {} });
  app.tick();
  assert.equal(app.rendered.length, 1);
});

test("updates an incomplete card when the price and category arrive", () => {
  const app = routeHarness({ title: "Cotton shirt", price: null, crumbs: [], details: {} });
  for (let i = 0; i < 7; i += 1) app.tick();
  assert.equal(app.rendered.length, 1);
  app.setPage({ title: "Cotton shirt", price: 499, crumbs: ["T-shirts"], details: {} });
  app.tick();
  assert.equal(app.rendered.length, 2);
  app.tick();
  assert.equal(app.rendered.length, 2);
});

test("refreshes a product variant that changes without a new URL", () => {
  const app = routeHarness({ title: "Blue shirt", price: 499, crumbs: ["T-shirts"], details: {} });
  assert.equal(app.rendered.length, 1);
  app.setPage({ title: "Green shirt", price: 549, crumbs: ["T-shirts"], details: {} });
  app.tick();
  assert.equal(app.rendered.length, 2);
});

test("stops reading a page that never shows a product, but still recovers if one appears", () => {
  const app = routeHarness(null);
  for (let i = 0; i < 40; i += 1) app.tick();
  // The first ten ticks read the whole page; after that only the cheap title and price check runs.
  assert.equal(app.reads.count, 10);
  app.setPage({ title: "Steel bottle", price: 650, crumbs: ["Bottles"], details: {} });
  app.tick();
  assert.equal(app.rendered.length, 1);
});

test("ignores tracking parameters that do not change the product", () => {
  const app = routeHarness({ title: "Blue shirt", price: 499, crumbs: ["T-shirts"], details: {} });
  app.context.location.search = "?pid=ITM123&ref=recs&th=1";
  for (let i = 0; i < 3; i += 1) app.tick();
  assert.equal(app.rendered.length, 1);
});
