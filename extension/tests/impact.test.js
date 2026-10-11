// Run: node --test extension/tests/impact.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { comparable, compareGroup, makeChoice, choiceDifference, impactTotals, planTotals, capacityFrom, prepareGuide, isOverdue,
  reminderCalendar, impactTimeline, stageDates } = require("../ui/impact.js");

const phone = (fields) => ({ kind: "device", category: "phone", brand: "Apple", carbonBasis: null, ...fields });
const fridge = (fields) => ({ kind: "appliance", type: "refrigerators", capacity: { value: 240, unit: "litres" }, ...fields });

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

test("appliances compare only at about the same size, stated on both listings", () => {
  const a = fridge({ key: "a", kwhYear: 190 });
  assert.equal(comparable(a, fridge({ key: "b", kwhYear: 250, capacity: { value: 250, unit: "litres" } })), true);
  assert.equal(comparable(a, fridge({ key: "b", kwhYear: 250, capacity: { value: 340, unit: "litres" } })), false);
  assert.equal(comparable(a, fridge({ key: "b", kwhYear: 250, capacity: null })), false);
  assert.equal(comparable(a, fridge({ key: "b", kwhYear: 250, capacity: { value: 240, unit: "kg" } })), false);
});

test("capacity is read only from size labels", () => {
  assert.deepEqual(capacityFrom({ "Capacity": "240 L" }), { value: 240, unit: "litres" });
  assert.deepEqual(capacityFrom({ "Tonnage": "1.5 Ton" }), { value: 1.5, unit: "tons" });
  assert.equal(capacityFrom({ "Item Weight": "7 kg" }), null);
});

test("preparation guides come from the maker, or Google for other Android phones", () => {
  assert.match(prepareGuide("Apple", "phone").url, /support\.apple\.com/);
  assert.match(prepareGuide("Samsung", "phone").url, /samsung\.com\/in/);
  assert.match(prepareGuide("Xiaomi", "phone").url, /support\.google\.com/);
  assert.equal(prepareGuide("LG", "appliance"), null);
});

test("reminders: overdue after the day passes, and a valid calendar file", () => {
  assert.equal(isOverdue("2026-10-01", "2026-10-11"), true);
  assert.equal(isOverdue("2026-10-11", "2026-10-11"), false);
  const file = reminderCalendar({ actionId: "a1", day: "2026-10-20", title: "Hand over; today", details: "x" });
  assert.match(file, /DTSTART;VALUE=DATE:20261020/);
  assert.ok(file.includes("SUMMARY:Hand over\\; today"));
  assert.match(file, /^BEGIN:VCALENDAR[\s\S]*END:VCALENDAR$/);
});

test("the all-time record adds chosen differences in date order and keeps bought and electricity apart", () => {
  const at = (day) => new Date(`2026-10-${day}T10:00:00Z`);
  const first = makeChoice(phone({ key: "air", carbonKg: 55 }), phone({ key: "pro", carbonKg: 63 }), "chosen", at("05"));
  const second = makeChoice(phone({ key: "16e", carbonKg: 48 }), phone({ key: "16", carbonKg: 56 }), "purchased", at("09"));
  const appliance = makeChoice(fridge({ key: "f1", kwhYear: 190 }), fridge({ key: "f2", kwhYear: 250 }), "chosen", at("07"));
  const considering = makeChoice(phone({ key: "x", carbonKg: 40 }), phone({ key: "y", carbonKg: 90 }), "considered", at("08"));
  const { points, totals } = impactTimeline([second, considering, appliance, first]);
  assert.deepEqual(points.map((point) => point.at.slice(8, 10)), ["05", "07", "09"]);
  assert.deepEqual(points.map((point) => point.deviceKg), [8, 8, 16]);
  assert.deepEqual(totals, { deviceKg: 16, boughtKg: 8, kwhYear: 60, choices: 3 });
});

test("a choice remembers when it was chosen and when it was bought", () => {
  const now = new Date("2026-10-11T00:00:00Z");
  assert.deepEqual(stageDates({}, "considered", now), { chosenAt: null, purchasedAt: null });
  const chosen = stageDates({}, "chosen", now);
  assert.equal(chosen.chosenAt, now.toISOString());
  const later = new Date("2026-10-15T00:00:00Z");
  const bought = stageDates(chosen, "purchased", later);
  assert.equal(bought.chosenAt, now.toISOString());
  assert.equal(bought.purchasedAt, later.toISOString());
  assert.equal(stageDates(bought, "chosen", later).purchasedAt, null);
});
