// Run: node --test extension/tests/impact.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { comparable, compareGroup, makeChoice, choiceDifference, impactTotals, planTotals } = require("../ui/impact.js");

const phone = (fields) => ({ kind: "device", category: "phone", brand: "Apple", carbonBasis: null, ...fields });
const fridge = (fields) => ({ kind: "appliance", type: "refrigerators", ...fields });

test("maker-reported footprints compare only within one maker and one kind of device", () => {
  const pro = phone({ key: "a", carbonKg: 70 });
  const air = phone({ key: "b", carbonKg: 50 });
  assert.equal(comparable(air, pro), true);
  assert.equal(comparable(phone({ key: "c", brand: "Samsung", carbonKg: 40 }), pro), false);
  assert.equal(comparable(phone({ key: "d", category: "tablet", carbonKg: 40 }), pro), false);
  assert.equal(comparable(phone({ key: "e", carbonKg: null }), pro), false);
  assert.equal(comparable(pro, pro), false);
});

test("per-storage footprints compare only when the chosen one has at least as much storage", () => {
  const big = phone({ key: "a", carbonKg: 80, carbonBasis: "256GB model" });
  const small = phone({ key: "b", carbonKg: 60, carbonBasis: "128GB model" });
  assert.equal(comparable(small, big), false);
  assert.equal(comparable(phone({ key: "c", carbonKg: 60, carbonBasis: "512GB model" }), big), true);
});

test("appliances compare only within one type and only with stated yearly use", () => {
  assert.equal(comparable(fridge({ key: "a", kwhYear: 190 }), fridge({ key: "b", kwhYear: 250 })), true);
  assert.equal(comparable(fridge({ key: "a", kwhYear: 190 }), fridge({ key: "b", kwhYear: null })), false);
  assert.equal(comparable(fridge({ key: "a", kwhYear: 190 }), fridge({ key: "b", type: "washing machines", kwhYear: 90 })), false);
});

test("ordinary products with only a category estimate are never grouped for comparison", () => {
  assert.equal(compareGroup({ kind: "product", estimateKg: 2 }), null);
  assert.equal(compareGroup(phone({ carbonKg: 50 })), "device:phone:Apple");
  assert.equal(compareGroup(fridge({ kwhYear: 200 })), "appliance:refrigerators");
});

test("a choice records both sides and never counts a negative difference", () => {
  const choice = makeChoice(phone({ key: "air", name: "iPhone Air", carbonKg: 50 }), phone({ key: "pro", name: "iPhone Pro", carbonKg: 70 }));
  assert.equal(choice.id, "air>pro");
  assert.equal(choiceDifference(choice), 20);
  const reverse = makeChoice(phone({ key: "pro", carbonKg: 70 }), phone({ key: "air", carbonKg: 50 }));
  assert.equal(choiceDifference(reverse), 0);
  assert.equal(makeChoice(phone({ key: "x", carbonKg: 1 }), fridge({ key: "y", kwhYear: 1 })), null);
});

test("considering is engagement, not impact; bought counts only what the shopper said they bought", () => {
  const air = phone({ key: "air", carbonKg: 50 });
  const pro = phone({ key: "pro", carbonKg: 70 });
  const totals = impactTotals([
    makeChoice(air, pro, "considered"),
    makeChoice(phone({ key: "a2", carbonKg: 40 }), phone({ key: "p2", carbonKg: 70 }), "chosen"),
    makeChoice(fridge({ key: "f1", kwhYear: 190 }), fridge({ key: "f2", kwhYear: 250 }), "purchased"),
  ]);
  assert.equal(totals.considered, 1);
  assert.deepEqual(totals.deviceKg, { chosen: 30, purchased: 0, count: 1 });
  assert.deepEqual(totals.applianceKwhYear, { chosen: 60, purchased: 60, count: 1 });
});

test("plan totals keep saved, reported and verified apart", () => {
  const totals = planTotals([
    { status: "planned" }, { status: "done" }, { status: "done", verified: { at: "2026-10-11" } },
  ]);
  assert.deepEqual(totals, { saved: 3, waiting: 1, reported: 2, verified: 1 });
});
