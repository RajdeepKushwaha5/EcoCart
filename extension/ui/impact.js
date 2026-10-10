// The shopper's shortlist, recorded choices and activity, and the rules for turning them into impact figures.
// Kept only in this browser (chrome.storage.local). Loaded as a plain script by the content scripts and the dashboard,
// so it defines globals. The rules are written out in docs/impact.md.

const SHORTLIST_KEY = "shortlist";
const CHOICES_KEY = "choices";
const ACTIVITY_KEY = "activity";
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

// Appliances compare only within the same type (the shop's most specific category) and only when both labels
// state yearly electricity use, which BEE labels measure under the same standard test.
function appliancesComparable(chosen, instead) {
  if (!chosen || !instead || chosen.key === instead.key) return false;
  if (chosen.kind !== "appliance" || instead.kind !== "appliance") return false;
  if (!chosen.type || chosen.type !== instead.type) return false;
  return chosen.kwhYear != null && instead.kwhYear != null;
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
    unit: device ? "kg CO2e" : "kWh a year",
    brand: device ? chosen.brand : null,
    type: device ? chosen.category : chosen.type,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
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

function planTotals(actions) {
  return {
    saved: actions.length,
    waiting: actions.filter((action) => action.status === "planned").length,
    reported: actions.filter((action) => action.status === "done").length,
    verified: actions.filter((action) => action.verified).length,
  };
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
  const saved = existing ? { ...existing, stage: choice.stage, updatedAt: choice.updatedAt } : choice;
  await chrome.storage.local.set({ [CHOICES_KEY]: [saved, ...others].slice(0, MAX_CHOICES) });
  await logActivity(saved.stage === "considered" ? "compared" : "chose", { name: saved.chosen.name, kind: saved.kind });
  return saved;
}

async function setChoiceStage(id, stage) {
  if (!CHOICE_STAGES.includes(stage)) return;
  const choices = (await loadChoices()).map((choice) => (choice.id === id
    ? { ...choice, stage, updatedAt: new Date().toISOString() } : choice));
  await chrome.storage.local.set({ [CHOICES_KEY]: choices });
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
  module.exports = { comparable, compareGroup, makeChoice, choiceDifference, impactTotals, planTotals, storageGb, monthKey };
}
