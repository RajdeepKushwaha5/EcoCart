// Run: node --test extension/tests/category.test.js
const test = require("node:test");
const assert = require("node:assert");
const { detectCategory } = require("../content/common.js");

test("the breadcrumb decides", () => {
  assert.strictEqual(detectCategory(["Electronics", "Mobiles & Accessories", "Smartphones & Basic Mobiles", "Smartphones"], "Galaxy A56"), "phone");
  assert.strictEqual(detectCategory(["Computers & Accessories", "Laptops", "Traditional Laptops"], "MacBook Air"), "laptop");
  assert.strictEqual(detectCategory(["Clothing & Accessories", "T-shirts"], "iPhone print T-shirt"), null);
});

test("accessory breadcrumbs are never devices", () => {
  assert.strictEqual(detectCategory(["Electronics", "Mobile Accessories", "Cases & Covers"], "iPhone 16 case"), null);
  assert.strictEqual(detectCategory(["Computers & Accessories", "Laptop Accessories", "Bags & Sleeves", "Laptop Backpacks"], "Laptop backpack"), null);
});

test("brand-store pages without a breadcrumb use the listing's details", () => {
  assert.strictEqual(detectCategory(["iPhone"], "iPhone 18 Pro (256 GB) - Black", true), "phone");
  assert.strictEqual(detectCategory(["iPhone Air"], "Apple iPhone Air (256 GB)", true), "phone");
  assert.strictEqual(detectCategory(["Apple Watch Series 11"], "Apple Watch Series 11 GPS 42mm Case with Sport Band, works with iPhone", true), "watch");
  assert.strictEqual(detectCategory(["Mobile Cover"], "Cover for iPhone 17", true), null);
  assert.strictEqual(detectCategory(["Facewash"], "Mamaearth face wash", true), null);
});

test("with nothing else, the title is used", () => {
  assert.strictEqual(detectCategory([], "iPhone 18 Pro (256 GB) - Burgundy"), "phone");
  assert.strictEqual(detectCategory([], "Spigen case for iPhone 16"), null);
  assert.strictEqual(detectCategory([], "Cotton T-shirt"), null);
});
