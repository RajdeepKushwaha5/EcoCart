// The shopper's shortlist, recorded choices and activity, and the rules for turning them into impact figures.
// Kept only in this browser (chrome.storage.local). Loaded as a plain script by the content scripts and the dashboard,
// so it defines globals. The rules are written out in docs/impact.md.

const SHORTLIST_KEY = "shortlist";
const CHOICES_KEY = "choices";
const ACTIVITY_KEY = "activity";
const REMINDERS_KEY = "planReminders";
const MAX_SHORTLIST = 40;
const MAX_CHOICES = 100;
const MAX_ACTIVITY = 500;

// considered: the shopper is weighing it up. chosen: they decided on it. purchased: they told us they bought it.
const CHOICE_STAGES = ["considered", "chosen", "purchased"];
const STAGE_LABELS = { considered: "Considering", chosen: "Chosen", purchased: "Bought (you said)" };

// ---------- Comparison rules ----------

function storageGb(basis) {
  const found = /(\d+)\s*(GB|TB)/i.exec(basis || "");
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
  if (item.kind === "device" && item.carbonKg != null) return `device:${item.category}:${item.brand}`;
  if (item.kind === "appliance" && item.kwhYear != null && item.type) return `appliance:${item.type}`;
  return null;
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
  // Choices that involve the item go with it, so no total counts something the shopper took back.
  const choices = (await loadChoices()).filter((choice) => choice.chosen.key !== key && choice.instead.key !== key);
  await chrome.storage.local.set({ [SHORTLIST_KEY]: shortlist, [CHOICES_KEY]: choices });
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
  const saved = existing
    ? { ...existing, stage: choice.stage, updatedAt: choice.updatedAt, ...stageDates(existing, choice.stage) }
    : choice;
  await chrome.storage.local.set({ [CHOICES_KEY]: [saved, ...others].slice(0, MAX_CHOICES) });
  await logActivity(saved.stage === "considered" ? "compared" : "chose", { name: saved.chosen.name, kind: saved.kind });
  return saved;
}

async function setChoiceStage(id, stage) {
  if (!CHOICE_STAGES.includes(stage)) return;
  const now = new Date();
  const choices = (await loadChoices()).map((choice) => (choice.id === id
    ? { ...choice, stage, updatedAt: now.toISOString(), ...stageDates(choice, stage, now) } : choice));
  await chrome.storage.local.set({ [CHOICES_KEY]: choices });
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
if (typeof module !== "undefined") {
  module.exports = {
    comparable, compareGroup, makeChoice, choiceDifference, impactTotals, planTotals, storageGb, monthKey,
    capacityFrom, prepareGuide, isOverdue, reminderCalendar, impactTimeline, stageDates,
  };
}
