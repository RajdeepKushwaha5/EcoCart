// The shopper's shortlist, recorded choices and activity, and the rules for turning them into impact figures.
// Kept only in this browser (chrome.storage.local). Loaded as a plain script by the content scripts and the dashboard,
// so it defines globals. The rules are written out in docs/impact.md.

const SHORTLIST_KEY = "shortlist";
const CHOICES_KEY = "choices";
const ACTIVITY_KEY = "activity";
const REMINDERS_KEY = "planReminders";
const PURCHASES_KEY = "purchases";
const RECENT_KEY = "recentProducts";
const NAME_KEY = "userName";
const MAX_PURCHASES = 500;
const MAX_RECENT = 20;
const MAX_SHORTLIST = 40;
const MAX_CHOICES = 100;
const MAX_ACTIVITY = 500;

// considered: the shopper is weighing it up. chosen: they decided on it. purchased: they told us they bought it.
const CHOICE_STAGES = ["considered", "chosen", "purchased"];
const STAGE_LABELS = { considered: "Considering", chosen: "Chosen", purchased: "Bought (you said)" };

// ---------- Comparison rules ----------

function storageGb(basis) {
  const found = [...String(basis || "").matchAll(/(\d+)\s*(GB|TB)/gi)].at(-1);
  if (!found) return null;
  return Number(found[1]) * (found[2].toUpperCase() === "TB" ? 1024 : 1);
}

// Two maker-reported footprints compare only within one maker (makers measure differently), for the same kind of
// device, on the same basis. Per-storage figures compare only when the chosen one has at least as much storage,
// so a smaller configuration never looks better just for being smaller. The same rule as backend/src/compare.py.
function devicesComparable(chosen, instead) {
  if (!chosen || !instead || chosen.key === instead.key) return false;
  if (chosen.kind !== "device" || instead.kind !== "device") return false;
  if (chosen.brand !== instead.brand || chosen.category !== instead.category) return false;
  if (chosen.carbonKg == null || instead.carbonKg == null) return false;
  if ((chosen.carbonBasis || null) === (instead.carbonBasis || null)) return true;
  const storageOnly = /^\d+\s*(?:GB|TB)(?:\s+(?:SSD\s+)?model)?$/i;
  if (!storageOnly.test(chosen.carbonBasis || "") || !storageOnly.test(instead.carbonBasis || "")) return false;
  const chosenGb = storageGb(chosen.carbonBasis);
  const insteadGb = storageGb(instead.carbonBasis);
  return chosenGb !== null && insteadGb !== null && chosenGb >= insteadGb;
}

// An appliance's size as its listing states it: litres, kg of laundry, tons of cooling, inches of screen.
const CAPACITY_UNITS = [
  [/\b(\d+(?:\.\d+)?)\s*(?:l|ltr|litres?|liters?)\b/i, "litres"],
  [/\b(\d+(?:\.\d+)?)\s*(?:tons?|tr)\b/i, "tons"],
  [/\b(\d+(?:\.\d+)?)\s*kg\b/i, "kg"],
  [/\b(\d+(?:\.\d+)?)\s*(?:inch|inches|in|")(?=\W|$)/i, "inches"],
];
const CAPACITY_LABEL = /capacity|volume|tonnage|screen size|display size/i;
const CAPACITY_TOLERANCE = 0.1;

function capacityFrom(details) {
  for (const [label, value] of Object.entries(details || {})) {
    if (!CAPACITY_LABEL.test(label)) continue;
    for (const [pattern, unit] of CAPACITY_UNITS) {
      const found = pattern.exec(value);
      if (found) return { value: Number(found[1]), unit };
    }
  }
  return null;
}

// Appliances compare only within the same type (the shop's most specific category), at about the same size, and
// only when both labels state yearly electricity use, which BEE labels measure under the same standard test.
// A bigger fridge uses more electricity, so without a stated size on both there is no fair comparison.
function appliancesComparable(chosen, instead) {
  if (!chosen || !instead || chosen.key === instead.key) return false;
  if (chosen.kind !== "appliance" || instead.kind !== "appliance") return false;
  if (!chosen.type || chosen.type !== instead.type) return false;
  if (chosen.kwhYear == null || instead.kwhYear == null) return false;
  const [a, b] = [chosen.capacity, instead.capacity];
  if (!a || !b || a.unit !== b.unit) return false;
  return Math.abs(a.value - b.value) <= CAPACITY_TOLERANCE * Math.max(a.value, b.value);
}

function comparable(chosen, instead) {
  return devicesComparable(chosen, instead) || appliancesComparable(chosen, instead);
}

// The group a shortlisted item can be compared within, or null when it cannot be compared with anything.
function compareGroup(item) {
  if (item.kind === "device" && item.carbonKg != null) return `device:${item.category}:${item.brand}:${item.carbonBasis || "unspecified"}`;
  if (item.kind === "appliance" && item.kwhYear != null && item.type && item.capacity) return `appliance:${item.type}:${item.capacity.unit}`;
  return null;
}

function listingStorageGb(page) {
  for (const [label, value] of Object.entries(page.details || {})) {
    if (/storage capacity|hard (?:drive|disk) size|\brom\b/i.test(label) && !/\bram\b/i.test(label)) {
      const size = storageGb(value);
      if (size !== null) return size;
    }
  }
  const title = page.title || "";
  const sizes = [...title.matchAll(/(\d+)\s*(GB|TB)\b/gi)].filter((match) => {
    const after = title.slice(match.index + match[0].length, match.index + match[0].length + 20);
    const before = title.slice(Math.max(0, match.index - 20), match.index);
    return !/^\s*(?:RAM|unified memory)\b/i.test(after) && !/\bRAM\s*[:=-]\s*$/i.test(before);
  }).map((match) => Number(match[1]) * (match[2].toUpperCase() === "TB" ? 1024 : 1));
  const unique = [...new Set(sizes)];
  return unique.length === 1 ? unique[0] : null;
}

function comparisonGroups(items) {
  const groups = [];
  for (const item of items) {
    const key = compareGroup(item);
    if (!key) continue;
    const group = groups.find(([id, peers]) => id === key && peers.every((peer) => comparable(item, peer) && comparable(peer, item)));
    if (group) group[1].push(item);
    else groups.push([key, [item]]);
  }
  return groups;
}

// A report for one storage configuration or region is not a measurement of another listing.
function listingCarbon(card, page) {
  const carbon = card?.carbon;
  if (!carbon) return { carbon: null, reason: null };
  const basis = carbon.basis || "";
  const reportedStorage = storageGb(basis);
  const listingStorage = listingStorageGb(page);
  if (/\b(?:EU(?:\/UK)?|UK|US|China)\s+model\b/i.test(basis)) return { carbon: null, reason: `The available report covers ${basis}. Its applicability to this Indian listing is unverified.` };
  const listingSpecs = `${page.title || ""} ${Object.values(page.details || {}).join(" ")}`;
  const gpu = /\b(\d+)-core GPU\b/i.exec(basis);
  if (gpu && !new RegExp(`\\b${gpu[1]}[- ]core\\s+(?:GPU|graphics)\\b`, "i").test(listingSpecs)) {
    return { carbon: null, reason: `The report covers ${basis}. The listing does not confirm the same GPU configuration.` };
  }
  if (/Wi-Fi\s*\+\s*Cellular/i.test(basis) && !/\b(?:cellular|5G)\b/i.test(listingSpecs)) {
    return { carbon: null, reason: `The report covers ${basis}. The listing does not confirm cellular connectivity.` };
  }
  if (reportedStorage !== null && reportedStorage !== listingStorage) {
    return { carbon: null, reason: `The available report covers ${basis}. This listing's storage does not match or could not be confirmed.` };
  }
  return { carbon, reason: null };
}

function validateBackup(backup, allowedKeys) {
  const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  const date = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
  if (backup?.app !== "EcoCart" || backup.version !== 1 || !object(backup.data) || !date(backup.savedAt)) {
    throw new Error("Unsupported backup");
  }
  const data = Object.fromEntries(Object.entries(backup.data).filter(([key]) => allowedKeys.includes(key)));
  const lists = { shortlist: 40, choices: 100, activity: 500, viewedPhones: 500, purchases: 500, recentProducts: 20 };
  for (const [key, limit] of Object.entries(lists)) {
    if (!(key in data)) continue;
    if (!Array.isArray(data[key]) || data[key].length > limit || !data[key].every(object)) throw new Error(`Invalid ${key}`);
  }
  const walk = (value, depth = 0) => {
    if (depth > 12) throw new Error("Backup is too deeply nested");
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Invalid number");
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (["url", "source", "carbonSource"].includes(key) && child != null && !/^https?:\/\//i.test(child)) throw new Error("Invalid link");
      if (["kg", "carbonKg", "kwhYear", "price", "value"].includes(key) && typeof child === "number" && child < 0) throw new Error("Negative value");
      if (["kg", "carbonKg", "kwhYear", "price", "estimateKg"].includes(key) && child != null && typeof child !== "number") throw new Error("Invalid numeric field");
      walk(child, depth + 1);
    }
  };
  walk(data);
  const text = (value) => typeof value === "string" && value.length > 0 && value.length <= 500;
  for (const item of data.shortlist || []) {
    if (!text(item.key) || !text(item.name) || !["device", "appliance", "product"].includes(item.kind)) throw new Error("Invalid shortlist item");
  }
  for (const choice of data.choices || []) {
    if (!text(choice.id) || !CHOICE_STAGES.includes(choice.stage) || !["device", "appliance"].includes(choice.kind)
      || !date(choice.createdAt) || !date(choice.updatedAt)) throw new Error("Invalid choice");
    for (const side of [choice.chosen, choice.instead]) {
      if (!object(side) || !text(side.key) || !text(side.name) || !Number.isFinite(side.value) || side.value < 0) throw new Error("Invalid comparison");
    }
  }
  for (const item of data.purchases || []) {
    if (!text(item.id) || !text(item.key) || !text(item.name) || !date(item.at)
      || (item.kg != null && (!Number.isFinite(item.kg) || item.kg < 0))
      || ![null, undefined, "reported", "estimate"].includes(item.basis)) throw new Error("Invalid purchase");
  }
  for (const item of data.activity || []) if (!date(item.at) || !text(item.type)) throw new Error("Invalid activity");
  for (const key of ["planReminders", "confirmedMatches"]) {
    if (key in data && (!object(data[key]) || !Object.values(data[key]).every(text))) throw new Error(`Invalid ${key}`);
  }
  if ("plannedFor" in data && !((Array.isArray(data.plannedFor) || object(data.plannedFor)) && Object.values(data.plannedFor).every(text))) throw new Error("Invalid plan markers");
  for (const key of ["userName", "lastCity", "sessionToken"]) {
    if (key in data && (typeof data[key] !== "string" || data[key].length > 500)) throw new Error(`Invalid ${key}`);
  }
  return data;
}

// ---------- Recording a choice ----------

function choiceId(chosen, instead) {
  return `${chosen.key}>${instead.key}`;
}

// A choice records one shortlisted item picked over one comparable item. Returns null if the pair is not comparable.
function makeChoice(chosen, instead, stage = "chosen", now = new Date()) {
  if (!CHOICE_STAGES.includes(stage) || !comparable(chosen, instead)) return null;
  const device = chosen.kind === "device";
  const side = (item) => ({
    key: item.key,
    name: item.name,
    value: device ? item.carbonKg : item.kwhYear,
    basis: device ? item.carbonBasis || null : null,
    source: device ? item.carbonSource || null : item.url || null,
    snapshot: productSnapshot({ ...item, kg: device ? item.carbonKg : null, basis: device ? "reported" : null,
      source: device ? item.carbonSource : null, reportBasis: item.carbonBasis, checked: item.carbonChecked }),
  });
  return {
    id: choiceId(chosen, instead),
    kind: chosen.kind,
    stage,
    chosen: side(chosen),
    instead: side(instead),
    unit: device ? "kg CO₂e" : "kWh a year",
    brand: device ? chosen.brand : null,
    type: device ? chosen.category : chosen.type,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...stageDates({}, stage, now),
  };
}

// chosenAt: the first time it counted. purchasedAt: when the shopper said they bought it, cleared if they take it back.
function stageDates(choice, stage, now = new Date()) {
  const counted = stage === "chosen" || stage === "purchased";
  return {
    chosenAt: counted ? choice.chosenAt || now.toISOString() : null,
    purchasedAt: stage === "purchased" ? choice.purchasedAt || now.toISOString() : null,
  };
}

// The difference a choice makes, never below zero: picking the higher option is recorded but saves nothing.
function choiceDifference(choice) {
  return Math.max(0, Number(choice.instead.value) - Number(choice.chosen.value));
}

// ---------- Totals ----------

// saveChoice keeps each item in at most one active choice, so nothing is counted twice here.
// Considering something is engagement, not impact, so only chosen and purchased choices add to the differences.
function impactTotals(choices) {
  const totals = {
    deviceKg: { chosen: 0, purchased: 0, count: 0 },
    applianceKwhYear: { chosen: 0, purchased: 0, count: 0 },
    considered: 0,
  };
  for (const choice of choices) {
    if (choice.stage === "considered") {
      totals.considered += 1;
      continue;
    }
    const bucket = choice.kind === "device" ? totals.deviceKg : totals.applianceKwhYear;
    const difference = choiceDifference(choice);
    bucket.count += 1;
    bucket.chosen += difference;
    if (choice.stage === "purchased") bucket.purchased += difference;
  }
  return totals;
}

// The all-time record of a shopper's choices, in date order, with running totals for the chart.
// Device lifecycle differences (kg CO2e, once) and appliance electricity differences (kWh a year) measure different
// things, so they are kept as separate totals and never added together.
function impactTimeline(choices) {
  const counted = choices
    .filter((choice) => choice.stage === "chosen" || choice.stage === "purchased")
    .map((choice) => ({ choice, at: choice.chosenAt || choice.updatedAt || choice.createdAt }))
    .filter((entry) => entry.at)
    .sort((a, b) => a.at.localeCompare(b.at));
  let deviceKg = 0;
  let boughtKg = 0;
  let kwhYear = 0;
  const points = counted.map(({ choice, at }) => {
    const difference = choiceDifference(choice);
    if (choice.kind === "device") {
      deviceKg += difference;
      if (choice.stage === "purchased") boughtKg += difference;
    } else {
      kwhYear += difference;
    }
    return { at, choice, difference, deviceKg, boughtKg, kwhYear };
  });
  return { points, totals: { deviceKg, boughtKg, kwhYear, choices: points.length } };
}

function planTotals(actions) {
  return {
    saved: actions.length,
    waiting: actions.filter((action) => action.status === "planned").length,
    reported: actions.filter((action) => action.status === "done").length,
    verified: actions.filter((action) => action.verified).length,
  };
}

// ---------- Purchases ----------

// A product as the card saw it: what it is, where, its price, and its footprint with where that number comes from.
// basis: "reported" (the maker's own lifecycle figure) or "estimate" (Open CEDA's average for its category and price).
function productSnapshot({ key, name, shop, url, price, kg, basis, category, source, reportBasis, checked }) {
  return { key, name: String(name || "").slice(0, 150), shop, url, price: price ?? null, kg: kg ?? null, basis: basis || null,
    category: category || null, source: source || null, reportBasis: reportBasis || null, checked: checked || null };
}

// The same product bought twice on one day counts once; on another day it is a new purchase.
function purchaseId(snapshot, at) {
  return `${snapshot.key}@${at.slice(0, 10)}`;
}

// Totals for the purchases dashboard. Only purchases with a footprint add to the kilograms.
// Makers' lifecycle reports and category estimates measure different things (a whole life, or making it from its
// price), so they are kept as two totals and never added into one number.
function purchaseTotals(purchases) {
  const byMonth = {};
  let reportedKg = 0;
  let estimateKg = 0;
  let reported = 0;
  let estimated = 0;
  for (const purchase of purchases) {
    if (purchase.kg == null) continue;
    const basis = purchase.basis === "reported" ? "reported" : "estimate";
    if (basis === "reported") {
      reportedKg += purchase.kg;
      reported += 1;
    } else {
      estimateKg += purchase.kg;
      estimated += 1;
    }
    const month = purchase.at.slice(0, 7);
    byMonth[month] ||= { reported: 0, estimate: 0 };
    byMonth[month][basis] += purchase.kg;
  }
  return { reportedKg, estimateKg, reported, estimated, byMonth, count: purchases.length,
    unknown: purchases.filter((purchase) => purchase.kg == null).length };
}

// The last twelve months, oldest first, as "YYYY-MM".
function lastMonths(count = 12, now = new Date()) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (count - 1 - index), 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  });
}

// Greener actions grow the plant: plans handed over, and lower-footprint choices made.
function greenActions(actions, choices) {
  const done = actions.filter((action) => action.status === "done").length;
  const chosen = choices.filter((choice) => (choice.stage === "chosen" || choice.stage === "purchased") && choiceDifference(choice) > 0).length;
  return done + chosen;
}

async function loadPurchases() {
  return readList(PURCHASES_KEY);
}

async function loadRecentProducts() {
  return readList(RECENT_KEY);
}

async function rememberProduct(snapshot) {
  const others = (await loadRecentProducts()).filter((item) => item.key !== snapshot.key);
  await chrome.storage.local.set({ [RECENT_KEY]: [{ ...snapshot, seenAt: new Date().toISOString() }, ...others].slice(0, MAX_RECENT) });
}

async function logPurchase(snapshot) {
  const at = new Date().toISOString();
  const id = purchaseId(snapshot, at);
  const purchases = (await loadPurchases()).filter((item) => item.id !== id);
  const choices = await loadChoices();
  const linked = choices.find((choice) => choice.chosen.key === snapshot.key);
  const updated = choices.map((choice) => choice === linked
    ? { ...choice, stage: "purchased", updatedAt: at, ...stageDates(choice, "purchased", new Date(at)) } : choice);
  await chrome.storage.local.set({
    [PURCHASES_KEY]: [{ ...snapshot, id, at, choiceId: linked?.id || null }, ...purchases].slice(0, MAX_PURCHASES),
    [CHOICES_KEY]: updated,
  });
  await logActivity("bought", { name: snapshot.name, kind: "purchase", key: snapshot.key });
}

async function hasPurchasedToday(key) {
  const today = new Date().toISOString().slice(0, 10);
  return (await loadPurchases()).some((item) => item.key === key && item.at.slice(0, 10) === today);
}

async function removePurchase(id) {
  const previous = await loadPurchases();
  const removed = previous.find((item) => item.id === id);
  const purchases = previous.filter((item) => item.id !== id);
  const choices = (await loadChoices()).map((choice) => removed?.choiceId === choice.id
    && !purchases.some((item) => item.choiceId === choice.id)
    ? { ...choice, stage: "chosen", ...stageDates(choice, "chosen"), updatedAt: new Date().toISOString() } : choice);
  await chrome.storage.local.set({ [PURCHASES_KEY]: purchases, [CHOICES_KEY]: choices });
}

// ---------- Old devices ----------

// Brands offered in the old-device form, by kind of device.
const OLD_DEVICE_BRANDS = {
  phone: ["Apple", "Google", "Motorola", "Nokia", "Nothing", "OnePlus", "Oppo", "Realme", "Samsung", "Vivo", "Xiaomi", "Other"],
  laptop: ["Apple", "Acer", "Asus", "Dell", "HP", "Lenovo", "MSI", "Samsung", "Other"],
  tablet: ["Apple", "Lenovo", "OnePlus", "Realme", "Samsung", "Xiaomi", "Other"],
  watch: ["Apple", "Amazfit", "boAt", "Fire-Boltt", "Noise", "OnePlus", "Samsung", "Other"],
  earbuds: ["Apple", "boAt", "JBL", "Noise", "OnePlus", "Samsung", "Sony", "Other"],
  tv: ["LG", "Samsung", "Sony", "Xiaomi", "OnePlus", "TCL", "Panasonic", "Vu", "Other"],
  appliance: ["LG", "Samsung", "Whirlpool", "Godrej", "Haier", "Voltas", "Daikin", "IFB", "Bosch", "Panasonic", "Other"],
  electronics: ["Apple", "Canon", "HP", "JBL", "Nikon", "Samsung", "Sony", "Other"],
};

// A plan for an old device the shopper is not replacing. The API needs a name for the new device, so this one says so.
const NO_NEW_DEVICE = "No new device";

// ---------- Getting an old phone ready to hand over ----------

// The maker's own instructions. Anything not listed gets Google's guide for Android phones.
const PREPARE_GUIDES = {
  Apple: { name: "Apple's checklist", url: "https://support.apple.com/en-in/109511" },
  Samsung: { name: "Samsung's reset guide", url: "https://www.samsung.com/in/support/mobile-devices/perform-a-factory-reset-on-samsung-galaxy-device/" },
  Android: { name: "Google's reset guide for Android", url: "https://support.google.com/android/answer/6088915" },
};

// Phones and tablets only: the guides and steps below are written for them.
function prepareGuide(brand, category) {
  if (category !== "phone" && category !== "tablet") return null;
  return PREPARE_GUIDES[brand] || PREPARE_GUIDES.Android;
}

const PREPARE_STEPS = [
  "Back up your photos, contacts and chats.",
  "Sign out of your accounts, so the device is not locked to you.",
  "Erase it with a factory reset.",
  "Take out the SIM card and any memory card.",
];

// ---------- Reminders ----------

async function loadReminders() {
  const stored = await chrome.storage.local.get(REMINDERS_KEY);
  return stored[REMINDERS_KEY] || {};
}

async function setReminder(actionId, day) {
  const reminders = await loadReminders();
  if (day) reminders[actionId] = day;
  else delete reminders[actionId];
  await chrome.storage.local.set({ [REMINDERS_KEY]: reminders });
}

function isOverdue(day, today = new Date().toISOString().slice(0, 10)) {
  return Boolean(day) && day < today;
}

// A calendar file for one reminder, so the shopper's own calendar app does the reminding.
function reminderCalendar({ actionId, day, title, details }) {
  const date = day.replaceAll("-", "");
  const escape = (text) => String(text).replace(/[\\;,]/g, (match) => `\\${match}`).replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//EcoCart//Old-device plan//EN",
    "BEGIN:VEVENT",
    `UID:${actionId}@ecocart`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `DTSTART;VALUE=DATE:${date}`,
    `SUMMARY:${escape(title)}`,
    `DESCRIPTION:${escape(details)}`,
    "BEGIN:VALARM", "TRIGGER:PT9H", "ACTION:DISPLAY", `DESCRIPTION:${escape(title)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}

function monthKey(isoText) {
  return String(isoText).slice(0, 7);
}

// ---------- Storage (browser only) ----------

async function readList(key) {
  const stored = await chrome.storage.local.get(key);
  return Array.isArray(stored[key]) ? stored[key] : [];
}

async function loadShortlist() {
  return readList(SHORTLIST_KEY);
}

async function loadChoices() {
  return readList(CHOICES_KEY);
}

async function loadActivity() {
  return readList(ACTIVITY_KEY);
}

async function addToShortlist(item) {
  const others = (await loadShortlist()).filter((entry) => entry.key !== item.key);
  await chrome.storage.local.set({ [SHORTLIST_KEY]: [{ ...item, addedAt: new Date().toISOString() }, ...others].slice(0, MAX_SHORTLIST) });
  await logActivity("shortlisted", item);
}

async function removeFromShortlist(key) {
  const shortlist = (await loadShortlist()).filter((entry) => entry.key !== key);
  // Recorded decisions are independent history. Their explicit Undo control removes them.
  await chrome.storage.local.set({ [SHORTLIST_KEY]: shortlist });
}

async function isShortlisted(key) {
  return (await loadShortlist()).some((entry) => entry.key === key);
}

async function saveChoice(choice) {
  const choices = await loadChoices();
  const existing = choices.find((item) => item.id === choice.id);
  // Each item takes part in at most one active choice, so one decision is never counted twice. Choosing again
  // replaces any earlier choice that involved either item.
  const involved = new Set([choice.chosen.key, choice.instead.key]);
  const others = choices.filter((item) => item.id !== choice.id
    && !involved.has(item.chosen.key) && !involved.has(item.instead.key));
  const stage = existing?.stage === "purchased" ? "purchased" : choice.stage;
  const saved = existing
    ? { ...existing, stage, updatedAt: choice.updatedAt, ...stageDates(existing, stage) }
    : choice;
  await chrome.storage.local.set({ [CHOICES_KEY]: [saved, ...others].slice(0, MAX_CHOICES) });
  await logActivity(saved.stage === "considered" ? "compared" : "chose", { name: saved.chosen.name, kind: saved.kind });
  return saved;
}

async function setChoiceStage(id, stage) {
  if (!CHOICE_STAGES.includes(stage)) return;
  const now = new Date();
  const previous = await loadChoices();
  const selected = previous.find((choice) => choice.id === id);
  if (!selected) return;
  if (stage === "purchased") {
    const snapshot = selected.chosen.snapshot || productSnapshot({ ...selected.chosen,
      kg: selected.kind === "device" ? selected.chosen.value : null,
      basis: selected.kind === "device" ? "reported" : null, reportBasis: selected.chosen.basis });
    await logPurchase(snapshot);
    return;
  }
  const choices = previous.map((choice) => (choice.id === id
    ? { ...choice, stage, updatedAt: now.toISOString(), ...stageDates(choice, stage, now) } : choice));
  const purchases = (await loadPurchases()).filter((purchase) => purchase.choiceId !== id);
  await chrome.storage.local.set({ [CHOICES_KEY]: choices, [PURCHASES_KEY]: purchases });
}

// The most recent choice not yet marked as bought, made within the last few days, for the order page to ask about.
async function recentUnboughtChoice(days = 14) {
  const cutoff = Date.now() - days * 86400000;
  return (await loadChoices())
    .filter((choice) => choice.stage === "chosen" && new Date(choice.chosenAt || choice.updatedAt).getTime() >= cutoff)
    .sort((a, b) => (b.chosenAt || b.updatedAt).localeCompare(a.chosenAt || a.updatedAt))[0] || null;
}

async function removeChoice(id) {
  await chrome.storage.local.set({ [CHOICES_KEY]: (await loadChoices()).filter((choice) => choice.id !== id) });
}

// type: checked, shortlisted, compared, chose, planned. Only the product name and kind are kept, never the page.
async function logActivity(type, { name, kind, key } = {}) {
  const now = new Date().toISOString();
  const activity = await loadActivity();
  // A product checked again on the same day counts once.
  if (type === "checked" && key && activity.some((entry) => entry.type === type && entry.key === key && entry.at.slice(0, 10) === now.slice(0, 10))) return;
  const entry = { type, name: String(name || "").slice(0, 120), kind: kind || null, key: key || null, at: now };
  await chrome.storage.local.set({ [ACTIVITY_KEY]: [entry, ...activity].slice(0, MAX_ACTIVITY) });
}

// Lets the Node tests load this file. The browser ignores it.
// ---------- Electricity cost ----------

// Running cost from the label's yearly kWh and the rate the shopper types from their own bill. EcoCart never
// assumes a rate: tariffs differ by state, slab and month.
const TARIFF_KEY = "tariffInrPerKwh";
const MAX_TARIFF = 50;

function validTariff(value) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate > 0 && rate <= MAX_TARIFF ? rate : null;
}

// The yearly running cost of each, the difference, and how many years of that difference the upfront price gap
// takes to repay. Payback is given only when the cheaper-to-run one costs more upfront.
function runningCost(kwh, otherKwh, rate, price, otherPrice) {
  const yearly = Math.round(kwh * rate);
  if (otherKwh == null) return { yearly };
  const otherYearly = Math.round(otherKwh * rate);
  const savedPerYear = otherYearly - yearly; // positive: this one is cheaper to run
  const upfront = price != null && otherPrice != null ? price - otherPrice : null; // positive: this one costs more
  const payback = upfront != null && upfront > 0 && savedPerYear > 0 ? Math.round((upfront / savedPerYear) * 10) / 10 : null;
  return { yearly, otherYearly, savedPerYear, upfront, payback };
}

async function loadTariff() {
  try {
    const { [TARIFF_KEY]: rate } = await chrome.storage.local.get(TARIFF_KEY);
    return validTariff(rate);
  } catch {
    return null;
  }
}

// ---------- Old-device check ----------

// Three questions about the old device. The answers only order the checked routes and explain why; every route
// stays visible, and nothing is said about a route that its own page does not say.
const OLD_DEVICE_QUESTIONS = {
  works: { label: "Does it work?", answers: [["yes", "Yes, fully"], ["partly", "Partly"], ["no", "No"]] },
  condition: { label: "Condition", answers: [["good", "Good"], ["worn", "Worn: scratches or dents"], ["damaged", "Damaged: cracked or broken parts"]] },
  goal: { label: "What do you want?", answers: [["money", "Money or credit for it"], ["reuse", "Someone keeps using it"], ["recycle", "Recycle it safely"]] },
};

const ROUTE_FACTS = [
  ["method", "How"],
  ["cost", "Cost to you"],
  ["youGet", "You get"],
  ["notWorking", "If it doesn't work"],
  ["area", "Where"],
];
const NOT_STATED = "Not stated on its page";

function routeFacts(option) {
  return ROUTE_FACTS.map(([key, label]) => [label, option[key] || NOT_STATED, Boolean(option[key])]);
}

function paysSomething(option) {
  return Boolean(option.youGet) && !/^nothing/i.test(option.youGet);
}

function routeFit(option, check) {
  let score = 0;
  const reasons = [];
  if (check.goal === "money") {
    if (paysSomething(option)) {
      score += 2;
      reasons.push(`You get: ${option.youGet}.`);
    } else if (option.youGet) {
      reasons.push(`${option.youGet}.`);
    } else {
      reasons.push("Its page does not say whether you get anything for it.");
    }
  } else if (check.goal === "reuse") {
    if (option.type === "reuse") {
      score += 2;
      reasons.push("A resale route, so the device can be used again.");
    } else if (option.type === "exchange") {
      score += 1;
      reasons.push("A trade-in: eligible devices are exchanged for credit.");
    } else {
      reasons.push("A recycling route: the materials are recovered, the device is not reused.");
    }
  } else if (check.goal === "recycle") {
    if (option.type === "recycle") {
      score += 2;
      reasons.push("A recycling route.");
    } else if (/recycl/i.test(option.notWorking || "")) {
      score += 1;
      reasons.push(`${option.notWorking}.`);
    } else {
      reasons.push("Mainly for resale or trade-in.");
    }
  }
  if (check.works === "no") {
    // Each fact counts once: a recycling promise already counted for the goal is not counted again here.
    if (option.notWorking) {
      if (!reasons.some((reason) => reason.startsWith(option.notWorking))) {
        score += 1;
        reasons.push(`If it doesn't work: ${option.notWorking}.`);
      }
    } else if (option.type !== "recycle") {
      score -= 1;
      reasons.push("Its page does not say whether it takes devices that don't work. Ask before booking.");
    }
  }
  return { option, score, reasons };
}

// The routes in order of fit (ties keep their listed order), plus general notes for these answers.
function routeAdvice(options, check) {
  const ranked = options.map((option) => routeFit(option, check))
    .map((fit, index) => ({ ...fit, index }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ index, ...fit }) => fit);
  const notes = [];
  if (check.goal !== "recycle" && (check.works === "partly" || check.works === "no" || check.condition === "damaged")) {
    notes.push("If it can be repaired, using it longer usually saves more than replacing it: most of a device's footprint comes from making it. Ask the maker's service centre for a quote first.");
  }
  if (check.condition === "damaged") {
    notes.push("If the battery is swollen, don't charge it or post it. Tell the collector before you hand it over.");
  }
  return { ranked, best: ranked[0] && ranked[0].score > 0 ? ranked[0].option.optionId : null, notes };
}

function validCheck(check) {
  return Object.entries(OLD_DEVICE_QUESTIONS)
    .every(([key, question]) => question.answers.some(([value]) => value === check?.[key]));
}

if (typeof module !== "undefined") {
  module.exports = {
    validTariff, runningCost,
    OLD_DEVICE_QUESTIONS, routeFacts, routeFit, routeAdvice, validCheck, NOT_STATED,
    comparable, compareGroup, comparisonGroups, listingStorageGb, listingCarbon, validateBackup, makeChoice, choiceDifference, impactTotals, planTotals, storageGb, monthKey,
    capacityFrom, prepareGuide, isOverdue, reminderCalendar, impactTimeline, stageDates,
    productSnapshot, purchaseId, purchaseTotals, lastMonths, greenActions,
  };
}
