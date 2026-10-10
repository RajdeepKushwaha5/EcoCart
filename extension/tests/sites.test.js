// Run: node --test extension/tests/sites.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { structuredItem, flipkartOfferPrice } = require("../content/sites.js");

test("finds a Flipkart product and breadcrumb inside JSON-LD graphs", () => {
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "BreadcrumbList", itemListElement: [{ name: "Home" }, { name: "T-shirts" }] },
      { "@type": ["Thing", "Product"], name: "Cotton T-shirt", offers: { price: "499" } },
    ],
  };
  assert.equal(structuredItem(data, "Product").name, "Cotton T-shirt");
  assert.equal(structuredItem(data, "BreadcrumbList").itemListElement[1].name, "T-shirts");
});

test("reads the first valid structured offer price", () => {
  assert.equal(flipkartOfferPrice({ offers: [{ price: "" }, { lowPrice: "₹1,299" }] }), 1299);
  assert.equal(flipkartOfferPrice({ offers: { price: "799" } }), 799);
  assert.equal(flipkartOfferPrice({ offers: { price: "not available" } }), null);
});
