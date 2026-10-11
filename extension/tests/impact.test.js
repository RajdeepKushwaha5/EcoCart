// Run: node --test extension/tests/impact.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const { comparable, compareGroup, makeChoice, choiceDifference, impactTotals, planTotals, capacityFrom, prepareGuide, isOverdue,
  reminderCalendar, impactTimeline, stageDates, purchaseId, purchaseTotals, lastMonths, greenActions,
  routeAdvice, routeFacts, validCheck, NOT_STATED, validTariff, runningCost } = require("../ui/impact.js");

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
  assert.equal(compareGroup(phone({ carbonKg: 50 })), "device:phone:Apple:unspecified");
  assert.equal(compareGroup(fridge({ kwhYear: 200 })), "appliance:refrigerators:litres");
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

test("purchases add up by month, keep reported and estimated apart, and skip unknown footprints", () => {
  const purchases = [
    { kg: 63, basis: "reported", at: "2026-10-05T10:00:00Z" },
    { kg: 2.5, basis: "estimate", at: "2026-10-09T10:00:00Z" },
    { kg: 3, basis: "estimate", at: "2026-09-20T10:00:00Z" },
    { kg: null, basis: null, at: "2026-10-10T10:00:00Z" },
  ];
  const totals = purchaseTotals(purchases);
  assert.equal(totals.totalKg, undefined); // never one combined number
  assert.equal(totals.reportedKg, 63);
  assert.equal(totals.estimateKg, 5.5);
  assert.equal(totals.reported, 1);
  assert.equal(totals.estimated, 2);
  assert.deepEqual(totals.byMonth, { "2026-10": { reported: 63, estimate: 2.5 }, "2026-09": { reported: 0, estimate: 3 } });
  assert.equal(totals.unknown, 1);
});

test("the same product bought twice on one day is one purchase", () => {
  assert.equal(purchaseId({ key: "amazon:B0X" }, "2026-10-11T08:00:00Z"), purchaseId({ key: "amazon:B0X" }, "2026-10-11T20:00:00Z"));
  assert.notEqual(purchaseId({ key: "amazon:B0X" }, "2026-10-11T08:00:00Z"), purchaseId({ key: "amazon:B0X" }, "2026-10-12T08:00:00Z"));
});

test("the chart covers the last twelve months and the plant grows with greener actions", () => {
  const months = lastMonths(12, new Date(2026, 9, 11));
  assert.equal(months.length, 12);
  assert.deepEqual([months[0], months[11]], ["2025-11", "2026-10"]);
  const lower = phone({ key: "low", carbonKg: 40 });
  const higher = phone({ key: "high", carbonKg: 60 });
  assert.equal(greenActions([{ status: "done" }, { status: "planned" }],
    [makeChoice(lower, higher), makeChoice(lower, higher, "considered"), makeChoice(lower, higher, "purchased")]), 3);
});

const ROUTES = [
  { optionId: "apple", type: "exchange", youGet: "Instant credit towards an Apple purchase, if the device is eligible",
    notWorking: "If it is not eligible for credit, Apple recycles it for free", cost: "Free" },
  { optionId: "samsung", type: "recycle", youGet: "Nothing: Samsung says there is no money or discount", notWorking: null, cost: "Free" },
  { optionId: "sell", type: "reuse", youGet: "Paid at pickup", notWorking: "Accepted, usually for a lower price", cost: "Free pickup" },
  { optionId: "sell-tv", type: "reuse", youGet: "Paid when it is collected", notWorking: null, cost: "Free pickup" },
];

test("old-device answers order the routes and say why, from each route's own facts", () => {
  const money = routeAdvice(ROUTES, { works: "yes", condition: "good", goal: "money" });
  assert.equal(money.best, "apple"); // ties keep the listed order
  assert.deepEqual(money.ranked.map((fit) => fit.option.optionId), ["apple", "sell", "sell-tv", "samsung"]);
  assert.match(money.ranked[3].reasons[0], /no money or discount/);
  assert.deepEqual(money.notes, []);

  const broken = routeAdvice(ROUTES, { works: "no", condition: "damaged", goal: "money" });
  // A paying route that does not say whether it takes broken devices still ranks above one that pays nothing.
  assert.deepEqual(broken.ranked.map((fit) => fit.option.optionId), ["apple", "sell", "sell-tv", "samsung"]);
  assert.ok(broken.ranked[2].reasons.some((reason) => /does not say whether it takes devices that don't work/.test(reason)));
  assert.equal(broken.notes.length, 2); // repair first, and battery safety

  const recycle = routeAdvice(ROUTES, { works: "no", condition: "worn", goal: "recycle" });
  assert.equal(recycle.best, "samsung");
  assert.deepEqual(recycle.notes, []);
});

test("route facts say when the page does not state something", () => {
  const facts = routeFacts(ROUTES[1]);
  assert.deepEqual(facts.find(([label]) => label === "If it doesn't work"), ["If it doesn't work", NOT_STATED, false]);
  assert.ok(validCheck({ works: "yes", condition: "good", goal: "reuse" }));
  assert.ok(!validCheck({ works: "maybe", condition: "good", goal: "reuse" }));
});

test("running cost uses the shopper's own rate, and payback only when it applies", () => {
  assert.equal(validTariff("8.5"), 8.5);
  assert.equal(validTariff(""), null);
  assert.equal(validTariff("0"), null);
  assert.equal(validTariff("500"), null);
  assert.deepEqual(runningCost(192, null, 8), { yearly: 1536 });
  // 192 against 230 kWh at 8 a unit: 304 a year less to run; 2,000 more upfront repays in about 6.6 years.
  assert.deepEqual(runningCost(192, 230, 8, 24000, 22000),
    { yearly: 1536, otherYearly: 1840, savedPerYear: 304, upfront: 2000, payback: 6.6 });
  // Cheaper to run and cheaper to buy: nothing to repay.
  assert.equal(runningCost(192, 230, 8, 21000, 22000).payback, null);
  assert.equal(runningCost(192, 230, 8, null, 22000).upfront, null);
});
