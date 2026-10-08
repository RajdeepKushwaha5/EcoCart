// Run: node --test extension/tests/labels.test.js
const test = require("node:test");
const assert = require("node:assert");
const { energyStars, listingCertifications } = require("../content/labels.js");

const page = (fields) => ({ title: "", details: {}, bullets: [], ...fields });
const names = (fields) => listingCertifications(page(fields)).map(([name]) => name);

test("stars come from the details table first", () => {
  assert.strictEqual(energyStars(page({ details: { "Energy Rating": "5 Star" }, title: "3 star BEE fan" })), 5);
});

test("stars in the title need the word BEE or energy nearby", () => {
  assert.strictEqual(energyStars(page({ title: "Crompton Fan | 5 Star BEE Rated" })), 5);
  assert.strictEqual(energyStars(page({ title: "Energy efficient 3-star split AC" })), 3);
  assert.strictEqual(energyStars(page({ title: "5 star customer favourite" })), null);
  assert.strictEqual(energyStars(page({ title: "BEE Star Rated ceiling fan" })), null);
  assert.strictEqual(energyStars(page({ title: "Energy saving, 5 star reviews" })), null);
});

test("certifications are found by their scheme names", () => {
  assert.deepStrictEqual(names({ title: "GOTS Certified Organic Cotton Swaddle" }), ["GOTS"]);
  assert.deepStrictEqual(names({ bullets: ["Made with FSC certified paper", "OEKO-TEX Standard 100"] }), ["OEKO-TEX", "FSC"]);
  assert.deepStrictEqual(names({ title: "Organic cotton T-shirt" }), []);
  assert.deepStrictEqual(names({ title: "Goats milk soap" }), []);
});

test("certifications in the product description count too", () => {
  assert.deepStrictEqual(names({ description: "Crafted from 100% GOTS certified organic cotton." }), ["GOTS"]);
});
