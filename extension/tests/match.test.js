// Run: node --test extension/tests/match.test.js
const test = require("node:test");
const assert = require("node:assert");
const { matchByAlias } = require("../content/match.js");

const CATALOG = [
  { modelId: "a55", aliases: ["Galaxy A55"] },
  { modelId: "a5", aliases: ["Galaxy A5"] },
  { modelId: "ip15", aliases: ["iPhone 15"], excludes: ["Pro", "Plus"] },
  { modelId: "ip15pro", aliases: ["iPhone 15 Pro"] },
];

const idFor = (title, catalog = CATALOG) => matchByAlias(title, catalog)?.modelId ?? null;

test("matches whole words only", () => {
  assert.strictEqual(idFor("Samsung Galaxy A55 5G (Navy, 8GB)"), "a55");
  assert.strictEqual(idFor("Samsung Galaxy A5 2017"), "a5");
});

test("longest alias wins", () => {
  assert.strictEqual(idFor("Apple iPhone 15 Pro (128 GB)"), "ip15pro");
});

test("excludes block a shorter alias", () => {
  assert.strictEqual(idFor("Apple iPhone 15 Plus (128 GB)"), null);
});

test("ties are treated as no match", () => {
  const catalog = [...CATALOG, { modelId: "dup", aliases: ["Galaxy A55"] }];
  assert.strictEqual(idFor("Galaxy A55", catalog), null);
});

test("unrelated titles do not match", () => {
  assert.strictEqual(idFor("Boat Airdopes 141"), null);
});

test("parts joined with + can appear in any order", () => {
  const catalog = [
    { modelId: "mba13", aliases: ["MacBook Air + M4 + 13"] },
    { modelId: "mba15", aliases: ["MacBook Air + M4 + 15"] },
  ];
  assert.strictEqual(idFor("Apple 2025 MacBook Air 13″ laptop with M4 chip", catalog), "mba13");
  assert.strictEqual(idFor("Apple MacBook Air M4 - (16 GB/256 GB SSD)", catalog), null);
});

test("a plus sign is not dropped", () => {
  const catalog = [{ modelId: "s25", aliases: ["Galaxy S25"], excludes: ["Plus", "Ultra"] }];
  assert.strictEqual(idFor("Samsung Galaxy S25 5G (Navy, 12GB)", catalog), "s25");
  assert.strictEqual(idFor("Samsung Galaxy S25+ 5G (Navy, 12GB)", catalog), null);
});
