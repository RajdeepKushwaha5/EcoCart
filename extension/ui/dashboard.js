import { actionCard, celebrate, formatDay, loadActions, node, pad, renderPlant } from "./shared.js";

const VIEWED_KEY = "viewedPhones";
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const plant = document.getElementById("plant");
const savedCount = document.getElementById("saved-count");
const doneCount = document.getElementById("done-count");
const viewedCount = document.getElementById("viewed-count");
const statusLine = document.getElementById("status");
const plans = document.getElementById("plans");
const compare = document.getElementById("compare");
const viewed = document.getElementById("viewed");

const showError = (message) => {
  statusLine.textContent = message;
};

function emptyState(title, text) {
  const empty = node("div", "empty");
  empty.append(node("p", "empty-title", title), node("p", "", text));
  return empty;
}

// "May 2031" -> Date, only for headlines that carry a sourced end date.
function supportEnd(phone) {
  const match = /^(\w+) (\d{4})$/.exec(phone.headline?.value || "");
  const month = match ? MONTHS.indexOf(match[1]) : -1;
  if (!phone.headline?.source || month < 0) return null;
  return new Date(Number(match[2]), month, 1);
}

function yearsFromNow(date) {
  return (date - Date.now()) / (365.25 * 24 * 3600 * 1000);
}

function barChart(title, note, rows, format) {
  const section = node("div", "chart");
  section.append(node("p", "eyebrow", title));
  const max = Math.max(...rows.map((row) => row.value));
  for (const row of rows) {
    const line = node("div", "bar-row");
    const track = node("div", "bar-track");
    const fill = node("div", "bar-fill");
    fill.style.width = `${Math.max(4, (row.value / max) * 100)}%`;
    track.append(fill);
    line.append(node("span", "bar-label", row.label), track, node("span", "bar-value", format(row)));
    section.append(line);
  }
  if (note) section.append(node("p", "note", note));
  return section;
}

const CATEGORY_TITLES = {
  phone: "Phones", laptop: "Laptops", tablet: "Tablets", watch: "Watches", earbuds: "Earbuds",
  tv: "TVs", appliance: "Appliances", electronics: "Other devices",
};

// Charts for one kind of device. A laptop next to a phone would make the bars meaningless.
function chartsFor(devices, heading) {
  const carbonRows = devices
    .filter((device) => device.carbonKg != null)
    .map((device) => ({ label: device.displayName, value: device.carbonKg }));
  const supportRows = devices
    .map((device) => ({ label: device.displayName, date: supportEnd(device) }))
    .filter((row) => row.date && yearsFromNow(row.date) > 0)
    .map((row) => ({ ...row, value: yearsFromNow(row.date) }));

  const charts = [];
  if (supportRows.length > 0) {
    charts.push(barChart(`${heading}: years of security updates left, at least`, null, supportRows,
      (row) => `${row.value.toFixed(1)} yrs`));
  }
  if (carbonRows.length > 0) {
    charts.push(barChart(`${heading}: lifecycle carbon reported by the maker (kg CO2e)`,
      "Brands measure this in different ways, so small gaps between brands do not mean much.",
      carbonRows, (row) => `${row.value.toLocaleString("en-IN")} kg`));
  }
  return charts;
}

function renderCompare(devices) {
  const groups = new Map();
  for (const device of devices) {
    const category = device.category || "phone";
    groups.set(category, [...(groups.get(category) || []), device]);
  }
  const charts = [...groups].flatMap(([category, group]) => chartsFor(group, CATEGORY_TITLES[category] || "Devices"));
  if (charts.length === 0) {
    compare.replaceChildren(emptyState("Nothing to compare yet", "Check two or more devices of the same kind on Amazon.in or Flipkart."));
    return;
  }
  compare.replaceChildren(...charts);
}

function fact(label, value) {
  const wrap = node("div");
  wrap.append(node("dt", "eyebrow", label), node("dd", value ? "" : "unknown", value || "Not published"));
  return wrap;
}

function phoneCard(phone) {
  const card = node("article", "phone");
  const facts = node("dl", "phone-facts");
  const support = phone.headline?.source ? phone.headline.value : null;
  const carbon = phone.carbonKg == null ? null : `${Number(phone.carbonKg).toLocaleString("en-IN")} kg CO2e`;
  facts.append(fact(phone.headline?.source ? phone.headline.label : "Update support", support),
    fact("Lifecycle carbon", carbon));
  card.append(
    node("p", "phone-name", phone.displayName),
    facts,
    node("p", "meta", `Checked ${formatDay(phone.viewedAt)}`),
  );
  return card;
}

async function loadViewed() {
  const stored = await chrome.storage.local.get(VIEWED_KEY);
  const phones = stored[VIEWED_KEY] || [];
  viewedCount.textContent = pad(phones.length);
  renderCompare(phones);
  if (phones.length === 0) {
    viewed.replaceChildren(emptyState("Nothing yet", "Open a device on Amazon.in or Flipkart and it will show up here."));
    return;
  }
  viewed.replaceChildren(...phones.map(phoneCard));
}

async function loadPlans({ completed = false } = {}) {
  statusLine.textContent = "";
  let actions;
  try {
    actions = await loadActions();
  } catch {
    showError("Couldn't load your plans. Check your connection.");
    renderPlant(plant, 0);
    return;
  }

  const done = actions.filter((action) => action.status === "done").length;
  savedCount.textContent = pad(actions.length);
  doneCount.textContent = pad(done);
  renderPlant(plant, done);
  if (completed) celebrate(done);

  if (actions.length === 0) {
    plans.replaceChildren(emptyState("No plans yet", "Plan what happens to your old device from any device page on Amazon.in or Flipkart."));
    return;
  }
  plans.replaceChildren(...actions.map((action) => actionCard(action, loadPlans, showError)));
}

document.getElementById("clear-history").addEventListener("click", async () => {
  await chrome.storage.local.remove(VIEWED_KEY);
  loadViewed();
});

loadPlans();
loadViewed();
