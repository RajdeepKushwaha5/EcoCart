// The personal dashboard: what the shopper checked, chose and did, and what each of those can honestly be counted as.
// impact.js and plant.js are loaded first as plain scripts, so their functions are globals here.
import { api, button, celebrate, formatDay, loadActions, node, pad, planStage, planSummary, PLANS_CHANGED_KEY, renderPlant } from "./shared.js";

const VIEWED_KEY = "viewedPhones";
const LOCAL_KEYS = new Set([SHORTLIST_KEY, CHOICES_KEY, ACTIVITY_KEY, VIEWED_KEY, REMINDERS_KEY]);
// Everything EcoCart keeps in this browser, for backup and restore. The session token links to the saved plans.
const BACKUP_KEYS = [SHORTLIST_KEY, CHOICES_KEY, ACTIVITY_KEY, VIEWED_KEY, REMINDERS_KEY, "plannedFor", "confirmedMatches",
  "lastCity", "sessionToken"];
const PLAN_REFRESH_MS = 60000;
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const DEVICE_WORDS = {
  phone: "phone", laptop: "laptop", tablet: "tablet", watch: "watch", earbuds: "earbuds",
  tv: "TV", appliance: "appliance", electronics: "device",
};
const ACTIVITY_TYPES = {
  checked: { label: "Checked", group: "checks" },
  shortlisted: { label: "Shortlisted", group: "choices" },
  compared: { label: "Compared", group: "choices" },
  chose: { label: "Chose", group: "choices" },
  planned: { label: "Planned", group: "plans" },
};

const state = {
  actions: [],
  plansError: false,
  routes: new Map(),
  shortlist: [],
  choices: [],
  activity: [],
  viewed: [],
  reminders: {},
  gridFactor: null,
  factors: [],
  month: "all",
  type: "all",
  tab: "overview",
  lastValues: new Map(),
  selectedDay: null,
};

const $ = (id) => document.getElementById(id);

// ---------- Small helpers ----------

function formatNumber(value, digits = 0) {
  return Number(value).toLocaleString("en-IN", { maximumFractionDigits: digits });
}

function link(url, label = "Source") {
  if (!url) return null;
  const anchor = node("a", "", `${label} ↗`);
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  return anchor;
}

function append(parent, ...children) {
  parent.append(...children.flat().filter(Boolean));
  return parent;
}

function emptyState(title, text) {
  return append(node("div", "empty"), node("p", "empty-title", title), node("p", "", text));
}

function inMonth(isoText) {
  return state.month === "all" || (isoText && monthKey(isoText) === state.month);
}

function shows(group) {
  return state.type === "all" || state.type === group;
}

function monthLabel(key) {
  const [year, month] = key.split("-").map(Number);
  return `${MONTHS[month - 1]} ${year}`;
}

// ---------- Loading ----------

async function loadLocal() {
  const stored = await chrome.storage.local.get([SHORTLIST_KEY, CHOICES_KEY, ACTIVITY_KEY, VIEWED_KEY, REMINDERS_KEY]);
  state.shortlist = stored[SHORTLIST_KEY] || [];
  state.choices = stored[CHOICES_KEY] || [];
  state.activity = stored[ACTIVITY_KEY] || [];
  state.viewed = stored[VIEWED_KEY] || [];
  state.reminders = stored[REMINDERS_KEY] || {};
}

async function loadPlans() {
  try {
    state.actions = await loadActions();
    state.plansError = false;
  } catch {
    state.plansError = true;
  }
  await loadRoutes();
}

// Route details come from the options list for each city a plan is in.
async function loadRoutes() {
  const cities = [...new Set(state.actions.map((action) => action.city))].filter((city) => !state.routes.has(city));
  await Promise.all(cities.map(async (city) => {
    try {
      const { options } = await api("GET", `/options?city=${encodeURIComponent(city)}`, undefined, false);
      state.routes.set(city, new Map(options.map((option) => [option.optionId, option])));
    } catch {
      // The plan still shows; only the route details are missing.
    }
  }));
}

async function loadGridFactor() {
  try {
    const { factors } = await api("GET", "/factors", undefined, false);
    state.factors = factors;
    state.gridFactor = factors.find((factor) => factor.factorId === "india-grid-kwh") || null;
  } catch {
    state.gridFactor = null;
  }
}

function markLive() {
  const live = $("live");
  live.replaceChildren(node("span", "live-dot"), `Live${state.plansError ? ", plans offline" : ""}`);
  live.title = `Updated ${new Date().toLocaleTimeString("en-IN")}`;
  live.classList.remove("pulse");
  void live.offsetWidth;
  live.classList.add("pulse");
}

// ---------- Figures ----------

function periodActions() {
  return state.actions.filter((action) => inMonth(action.createdAt) || inMonth(action.doneAt) || inMonth(action.verified?.at));
}

function periodChoices() {
  return state.choices.filter((choice) => inMonth(choice.updatedAt));
}

function periodActivity() {
  return state.activity.filter((entry) => inMonth(entry.at) && shows(ACTIVITY_TYPES[entry.type]?.group));
}

function figures() {
  const actions = periodActions();
  const plans = {
    waiting: actions.filter((action) => action.status === "planned" && inMonth(action.createdAt)),
    reported: actions.filter((action) => action.status === "done" && inMonth(action.doneAt)),
    verified: actions.filter((action) => action.verified && inMonth(action.verified.at)),
  };
  const choices = periodChoices();
  const totals = impactTotals(choices);
  const checks = state.activity.filter((entry) => entry.type === "checked" && inMonth(entry.at));
  return { plans, choices, totals, checked: new Set(checks.map((entry) => entry.key || entry.name)).size };
}

// ---------- Drawer: what a number counts and where it comes from ----------

function openDrawer(title, ...content) {
  const body = $("drawer-body");
  body.replaceChildren(node("h2", "drawer-title", title));
  body.lastChild.id = "drawer-title";
  append(body, ...content);
  $("drawer").hidden = false;
  $("drawer-close").focus();
}

function closeDrawer() {
  $("drawer").hidden = true;
}

function evidence(level, text) {
  return append(node("div", "evidence"), node("span", "evidence-level", level), node("p", "muted", text));
}

function itemList(items) {
  if (items.length === 0) return node("p", "muted", "Nothing in this period yet.");
  return append(node("ul", "detail-list"), items.map((item) => append(node("li"), ...[item].flat())));
}

function choiceLine(choice) {
  const difference = choiceDifference(choice);
  return [
    node("strong", "", choice.chosen.name),
    ` instead of ${choice.instead.name}: ${formatNumber(choice.chosen.value, 1)} against ${formatNumber(choice.instead.value, 1)} ${choice.unit}, `,
    `a difference of ${formatNumber(difference, 1)} ${choice.unit}. `,
    node("span", "pill", STAGE_LABELS[choice.stage]), " ",
    link(choice.chosen.source, `${choice.chosen.name} ${choice.kind === "device" ? "report" : "listing"}`), " ",
    link(choice.instead.source, `${choice.instead.name} ${choice.kind === "device" ? "report" : "listing"}`),
  ];
}

function planLine(action) {
  const stage = planStage(action);
  return [node("strong", "", action.optionName), ` ${planSummary(action)} `, node("span", `pill ${stage.key}`, stage.label)];
}

const DETAILS = {
  waiting: (f) => openDrawer("Plans waiting for action",
    evidence("Intention", "A saved plan says what you mean to do with an old device. It is not counted as an outcome."),
    itemList(f.plans.waiting.map(planLine))),
  reported: (f) => openDrawer("Handed over, reported by you",
    evidence("Your statement", "Counted when you mark a plan done. EcoCart cannot see the handover, so it stays labelled as reported."),
    itemList(f.plans.reported.map(planLine))),
  verified: (f) => openDrawer("Verified handovers",
    evidence("Receipt or partner confirmation",
      "Counted only when the team has seen a collection receipt or the collector confirmed it. No partner confirms handovers automatically yet, so this starts at zero."),
    itemList(f.plans.verified.map((action) => [...planLine(action), ` Evidence: ${action.verified.evidence}`]))),
  devices: (f) => openDrawer("Footprint difference of your choices",
    evidence("Maker-reported, same maker",
      "When you chose one device over another, the difference between the two lifecycle footprints the same maker reports. Different makers measure differently, so they are never compared. Considering is not counted, and nothing is counted twice."),
    node("p", "muted", "This is the difference between two products' reported footprints, not a measured saving: it assumes you would otherwise have bought the other one."),
    itemList(f.choices.filter((choice) => choice.kind === "device").map(choiceLine))),
  electricity: (f) => openDrawer("Electricity difference a year",
    evidence("Energy label", "The difference in yearly electricity use stated on the labels of two appliances of the same type. BEE labels measure it under a standard test, so real use depends on how you use it."),
    state.gridFactor
      ? append(node("p", "muted"), `Converted to CO2e with India's grid factor, ${state.gridFactor.kgCo2ePerUnit} kg per kWh. `, link(state.gridFactor.source, "Grid factor"))
      : null,
    itemList(f.choices.filter((choice) => choice.kind === "appliance").map(choiceLine))),
  checked: () => openDrawer("Products checked",
    evidence("Engagement", "How many products you opened with EcoCart. Looking at a product is not an environmental outcome, so it is never turned into kilograms."),
    itemList(state.activity.filter((entry) => entry.type === "checked" && inMonth(entry.at)).slice(0, 50)
      .map((entry) => [node("strong", "", entry.name), ` ${formatDay(entry.at)}`]))),
};

// ---------- Overview ----------

function tile(id, label, value, unit, sub, level) {
  const card = node("button", "tile-card");
  card.type = "button";
  const valueNode = node("span", "tile-value", value);
  if (state.lastValues.has(id) && state.lastValues.get(id) !== value) valueNode.classList.add("changed");
  state.lastValues.set(id, value);
  append(card,
    node("span", "eyebrow", label),
    append(node("span", "tile-figure"), valueNode, unit ? node("span", "tile-unit", unit) : null),
    sub ? node("span", "tile-sub", sub) : null,
    node("span", "tile-level", level));
  card.addEventListener("click", () => DETAILS[id](figures()));
  return card;
}

function overdueCount(actions) {
  return actions.filter((action) => isOverdue(state.reminders[action.actionId])).length;
}

function waitingNote(waiting) {
  const overdue = overdueCount(waiting);
  if (overdue) return `${overdue} past ${overdue === 1 ? "its" : "their"} reminder date`;
  return waiting.length ? "Each has a next step" : "Nothing waiting";
}

function renderOverview() {
  const f = figures();
  const tiles = [];
  if (shows("plans")) {
    tiles.push(
      tile("waiting", "Plans waiting for action", pad(f.plans.waiting.length), null, waitingNote(f.plans.waiting), "Intention"),
      tile("reported", "Handed over, reported by you", pad(f.plans.reported.length), null, "Marked done by you", "Your statement"),
      tile("verified", "Verified handovers", pad(f.plans.verified.length), null,
        f.plans.verified.length ? "With a receipt or partner confirmation" : "Needs a receipt or partner confirmation", "Verified"),
    );
  }
  if (shows("choices")) {
    const devices = f.totals.deviceKg;
    const power = f.totals.applianceKwhYear;
    const yearlyKg = state.gridFactor ? power.chosen * state.gridFactor.kgCo2ePerUnit : null;
    tiles.push(
      tile("devices", "Footprint difference of your choices", formatNumber(devices.chosen, 1), "kg CO₂e",
        devices.count ? `${devices.count} choice${devices.count === 1 ? "" : "s"}, ${formatNumber(devices.purchased, 1)} kg bought (you said)` : "Choose a lower-footprint option on a device card",
        "Maker-reported"),
      tile("electricity", "Electricity difference", formatNumber(power.chosen), "kWh a year",
        power.count ? `About ${formatNumber(yearlyKg, 0)} kg CO₂e a year on India's grid` : "Compare two shortlisted appliances", "Energy label"),
    );
  }
  if (shows("checks")) {
    tiles.push(tile("checked", "Products checked", pad(f.checked), null,
      `${state.shortlist.length} on your shortlist, ${f.totals.considered} being compared`, "Engagement"));
  }
  $("tiles").replaceChildren(...tiles);
}

// ---------- All time ----------

const SVG = "http://www.w3.org/2000/svg";

function svg(tag, attrs = {}, ...children) {
  const element = document.createElementNS(SVG, tag);
  for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
  element.append(...children.filter(Boolean));
  return element;
}

function roundSignificant(value, digits = 2) {
  if (!value) return 0;
  const scale = 10 ** (digits - 1 - Math.floor(Math.log10(Math.abs(value))));
  return Math.round(value * scale) / scale;
}

// A tidy top for the chart's scale: 1, 2, 2.5 or 5 times a power of ten.
function niceMax(value) {
  if (value <= 0) return 10;
  const power = 10 ** Math.floor(Math.log10(value));
  return [1, 2, 2.5, 5, 10].map((step) => step * power).find((step) => step >= value);
}

function everydayList(kg) {
  const items = state.factors.filter((factor) => factor.factorId !== "india-grid-kwh" || state.factors.length < 3);
  if (!kg || items.length === 0) return null;
  return append(node("ul", "alltime-everyday"), items.map((factor) => append(node("li"),
    node("strong", "", formatNumber(roundSignificant(kg / factor.kgCo2ePerUnit))),
    ` ${factor.unit} `, link(factor.source, "Source"))));
}

// Running total of the footprint difference, one step per recorded device choice.
function allTimeChart(points) {
  const width = 760;
  const height = 260;
  const pad = { top: 18, right: 24, bottom: 34, left: 52 };
  const devicePoints = points.filter((point) => point.choice.kind === "device");
  const start = new Date(devicePoints[0].at).getTime();
  const end = Math.max(Date.now(), start + 86400000);
  const top = niceMax(devicePoints[devicePoints.length - 1].deviceKg);
  const x = (time) => pad.left + ((time - start) / (end - start)) * (width - pad.left - pad.right);
  const y = (kg) => height - pad.bottom - (kg / top) * (height - pad.top - pad.bottom);

  const stepPath = (key) => {
    let path = `M ${x(start)} ${y(0)}`;
    let last = 0;
    for (const point of devicePoints) {
      const px = x(new Date(point.at).getTime());
      path += ` L ${px} ${y(last)} L ${px} ${y(point[key])}`;
      last = point[key];
    }
    return `${path} L ${x(end)} ${y(last)}`;
  };
  const area = `${stepPath("deviceKg")} L ${x(end)} ${y(0)} Z`;

  const grid = [0, top / 2, top].map((value) => svg("g", {},
    svg("line", { x1: pad.left, x2: width - pad.right, y1: y(value), y2: y(value), class: "grid-line" }),
    svg("text", { x: pad.left - 8, y: y(value) + 4, class: "axis-label", "text-anchor": "end" }, `${formatNumber(value)} kg`)));
  const dateLabel = (time) => new Date(time).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const axis = [
    svg("text", { x: pad.left, y: height - 10, class: "axis-label" }, dateLabel(start)),
    svg("text", { x: width - pad.right, y: height - 10, class: "axis-label", "text-anchor": "end" }, "Today"),
  ];

  const tooltip = node("div", "chart-tooltip");
  tooltip.hidden = true;
  const dots = devicePoints.map((point) => {
    const cx = x(new Date(point.at).getTime());
    const cy = y(point.deviceKg);
    const bought = point.choice.stage === "purchased";
    const dot = svg("circle", { cx, cy, r: 6, class: bought ? "dot bought" : "dot", tabindex: 0, role: "button",
      "aria-label": `${formatDay(point.at)}: chose ${point.choice.chosen.name}, ${formatNumber(point.difference, 1)} kg CO₂e lower` });
    const showTip = () => {
      tooltip.replaceChildren(
        node("strong", "", `${formatNumber(point.difference, 1)} kg CO₂e lower`),
        node("span", "", `${point.choice.chosen.name} instead of ${point.choice.instead.name}`),
        node("span", "muted", `${formatDay(point.at)}${bought ? ", bought (you said)" : ""}. Running total ${formatNumber(point.deviceKg, 1)} kg`));
      tooltip.style.left = `${(cx / width) * 100}%`;
      tooltip.style.top = `${(cy / height) * 100}%`;
      tooltip.hidden = false;
    };
    dot.addEventListener("mouseenter", showTip);
    dot.addEventListener("focus", showTip);
    dot.addEventListener("mouseleave", () => { tooltip.hidden = true; });
    dot.addEventListener("blur", () => { tooltip.hidden = true; });
    dot.addEventListener("click", () => DETAILS.devices(figures()));
    dot.addEventListener("keydown", (event) => { if (event.key === "Enter") DETAILS.devices(figures()); });
    return dot;
  });

  const chart = svg("svg", { viewBox: `0 0 ${width} ${height}`, class: "alltime-chart", role: "img",
    "aria-label": `Running total of the footprint difference of your choices, now ${formatNumber(devicePoints[devicePoints.length - 1].deviceKg, 1)} kg CO₂e` },
    ...grid,
    svg("path", { d: area, class: "area" }),
    svg("path", { d: stepPath("deviceKg"), class: "line chosen", pathLength: 1 }),
    svg("path", { d: stepPath("boughtKg"), class: "line bought", pathLength: 1 }),
    ...axis,
    ...dots);
  const legend = append(node("div", "legend"),
    append(node("span", "legend-item"), node("span", "swatch chose"), "Chosen"),
    append(node("span", "legend-item"), node("span", "swatch bought-line"), "Of which bought (you said)"));
  return append(node("div", "alltime-chart-wrap"), chart, tooltip, legend);
}

function renderAllTime() {
  const { points, totals } = impactTimeline(state.choices);
  const box = $("alltime");
  const value = formatNumber(totals.deviceKg, 1);
  const number = node("span", "alltime-number", value);
  if (state.lastValues.has("alltime") && state.lastValues.get("alltime") !== value) number.classList.add("changed");
  state.lastValues.set("alltime", value);

  const head = append(node("div", "alltime-head"),
    node("p", "eyebrow", "All time, from the choices you recorded"),
    append(node("p", "alltime-figure"), number, node("span", "alltime-unit", "kg CO₂e lower footprint")),
    node("p", "muted", totals.deviceKg
      ? `${totals.choices} choice${totals.choices === 1 ? "" : "s"}. ${formatNumber(totals.boughtKg, 1)} kg of it from products you said you bought.`
      : "Choose a lower-footprint option on a device card, and it adds up here."));
  const yearlyKg = state.gridFactor ? totals.kwhYear * state.gridFactor.kgCo2ePerUnit : null;
  const devicePoints = points.filter((point) => point.choice.kind === "device");

  box.replaceChildren(...[
    head,
    totals.deviceKg ? append(node("div", "alltime-terms"), node("p", "", "That is about the same as any one of these:"), everydayList(totals.deviceKg)) : null,
    devicePoints.length ? allTimeChart(points) : emptyState("No choices yet",
      "When a device card offers a lower-footprint option from the same maker, tap \"I'll choose this instead\". Each choice adds a step to this chart."),
    totals.kwhYear ? node("p", "alltime-power",
      `Appliances you chose also use about ${formatNumber(totals.kwhYear)} kWh a year less${yearlyKg ? `, about ${formatNumber(yearlyKg)} kg CO₂e a year on India's grid` : ""}. `
      + "That repeats every year the appliance runs, so it is counted separately.") : null,
    node("p", "note", "Each step is the difference between the footprint the maker reports for what you chose and for what you compared it with. "
      + "It is not a measured saving, and products you only looked at never count."),
  ].filter(Boolean));
}

// ---------- Next step ----------

function routeFor(action) {
  return state.routes.get(action.city)?.get(action.optionId) || null;
}

function renderNext() {
  const next = state.actions.filter((action) => action.status === "planned").sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  const box = $("next");
  if (next) {
    const route = routeFor(next);
    const old = next.oldDevice || next.oldPhone;
    const day = state.reminders[next.actionId];
    box.replaceChildren(...[
      node("p", "eyebrow accent", "Your next step"),
      node("p", "next-title", `Hand your old ${old.brand} ${DEVICE_WORDS[next.category] || "phone"} to ${next.optionName}`),
      day ? node("p", isOverdue(day) ? "due overdue" : "due", `${isOverdue(day) ? "Was due" : "Due"} ${formatDay(day)}`) : null,
      route ? node("p", "muted", route.handover) : null,
      button("Mark it done", () => changePlan(next, "PATCH", { status: "done" }), "primary"),
    ].filter(Boolean));
    return;
  }
  const comparable = shortlistGroups().find(([, items]) => items.length >= 2
    && !state.choices.some((choice) => items.some((item) => item.key === choice.chosen.key)));
  if (comparable) {
    box.replaceChildren(node("p", "eyebrow accent", "Your next step"),
      node("p", "next-title", "Pick from your shortlist"),
      node("p", "muted", `${comparable[1].length} comparable items are waiting in My comparisons.`),
      button("Compare them", () => selectTab("comparisons"), "primary"));
    return;
  }
  box.replaceChildren(node("p", "eyebrow accent", "Your next step"),
    node("p", "next-title", "Open a product on Amazon.in or Flipkart"),
    node("p", "muted", "The EcoCart card shows what is known about it and what you can do."));
}

// ---------- My actions ----------

async function changePlan(action, method, body) {
  $("status").textContent = "";
  try {
    await api(method, `/actions/${encodeURIComponent(action.actionId)}`, body);
    await chrome.storage.local.set({ [PLANS_CHANGED_KEY]: Date.now() });
    state.justChanged = action.actionId;
    await loadPlans();
    renderAll();
    if (body?.status === "done") celebrate(state.actions.filter((item) => item.status === "done").length);
  } catch {
    $("status").textContent = "Couldn't update that plan. Please try again.";
  }
}

function stageTrack(action) {
  const steps = [
    ["Planned", action.createdAt, true],
    ["Reported done", action.doneAt, action.status === "done"],
    ["Verified", action.verified?.at, Boolean(action.verified)],
  ];
  const requested = !action.verified && action.verificationRequest;
  return append(node("ol", "stages"), steps.map(([label, at, reached]) => append(node("li", reached ? "reached" : ""),
    node("span", "stage-dot"), node("span", "stage-label", label),
    node("span", "stage-date", reached && at ? formatDay(at) : label === "Verified" && requested ? `Requested ${formatDay(requested.at)}` : "Not yet"))));
}

function routeDetails(action) {
  const route = routeFor(action);
  if (!route) return node("p", "muted", `${action.optionName}, ${action.city}`);
  return append(node("div", "route"),
    node("p", "", route.handover),
    route.address ? node("p", "muted", route.address) : null,
    append(node("p", "meta"), link(route.url, "Website"), " ", link(route.source), ` checked ${formatDay(route.checked)}`),
    node("p", route.handoffConfirmed ? "flag ok" : "flag", route.handoffConfirmed ? "Handoff confirmed by our team" : "Handoff not yet confirmed by our team"));
}

function downloadFile(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function reminderRow(action) {
  const day = state.reminders[action.actionId];
  const wrap = node("div", "reminder");
  const input = node("input");
  input.type = "date";
  input.min = new Date().toISOString().slice(0, 10);
  input.value = day || "";
  input.setAttribute("aria-label", "Reminder date");
  input.addEventListener("change", () => setReminder(action.actionId, input.value || null));
  const old = action.oldDevice || action.oldPhone;
  const word = DEVICE_WORDS[action.category] || "phone";
  wrap.append(node("span", "eyebrow", "Remind me on"), input);
  if (day) {
    wrap.append(
      node("span", isOverdue(day) ? "due overdue" : "due", isOverdue(day) ? "Overdue" : `In ${Math.ceil((new Date(day) - Date.now()) / 86400000)} days`),
      button("Add to calendar", () => downloadFile(`ecocart-${action.actionId}.ics`, reminderCalendar({
        actionId: action.actionId,
        day,
        title: `Hand over your old ${old.brand} ${word} (EcoCart)`,
        details: `${action.optionName}, ${action.city}. Mark it done in EcoCart afterwards.`,
      }), "text/calendar"), "ghost small"),
    );
  }
  return wrap;
}

function checklist(action) {
  const old = action.oldDevice || action.oldPhone;
  const guide = prepareGuide(old.brand, action.category);
  if (!guide) return null;
  const details = node("details", "prepare");
  const summary = node("summary", "", "Before you hand it over");
  const steps = node("ol", "prepare-steps");
  for (const step of PREPARE_STEPS) steps.append(node("li", "", step));
  details.append(summary, steps, append(node("p", "meta"), "Step by step: ", link(guide.url, guide.name)));
  return details;
}

function verificationRow(action) {
  if (action.verified || action.status !== "done") return null;
  const request = action.verificationRequest;
  if (request) {
    return append(node("div", "verify requested"),
      node("p", "", `You asked for verification on ${formatDay(request.at)}: "${request.note}".`),
      node("p", "muted", "The team checks it with the collector. Until then it stays labelled as reported by you."));
  }
  const form = node("form", "verify");
  const input = node("input");
  input.type = "text";
  input.maxLength = 300;
  input.required = true;
  input.placeholder = "Collector and receipt or order number, for example Cashify order 4411";
  input.setAttribute("aria-label", "Receipt or order reference");
  form.append(
    node("p", "", "Have a receipt or order number? Ask the team to verify this handover."),
    append(node("div", "verify-row"), input, button("Ask for verification", () => form.requestSubmit(), "primary small")),
    node("p", "muted", "Only the reference you type is sent. Leave out names, addresses and phone numbers."),
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("POST", `/actions/${encodeURIComponent(action.actionId)}/verification`, { note: input.value.trim() });
      await chrome.storage.local.set({ [PLANS_CHANGED_KEY]: Date.now() });
      await loadPlans();
      renderAll();
    } catch {
      $("status").textContent = "Couldn't send the request. Please try again.";
    }
  });
  return form;
}

function timelineItem(action) {
  const stage = planStage(action);
  const item = node("article", `plan ${stage.key}${state.justChanged === action.actionId ? " moved" : ""}`);
  const controls = node("div", "controls");
  if (action.status === "planned") controls.append(button("Mark done", () => changePlan(action, "PATCH", { status: "done" }), "primary"));
  else if (!action.verified) controls.append(button("Undo", () => changePlan(action, "PATCH", { status: "planned" }), "ghost"));
  controls.append(button("Delete", () => changePlan(action, "DELETE"), "ghost"));
  return append(item,
    append(node("div", "plan-head"), node("span", "plan-title", action.optionName), node("span", `pill ${stage.key}`, stage.label)),
    node("p", "", planSummary(action)),
    stageTrack(action),
    routeDetails(action),
    action.status === "planned" ? reminderRow(action) : null,
    action.status === "planned" ? checklist(action) : null,
    verificationRow(action),
    action.verified
      ? node("p", "meta", `Verified ${formatDay(action.verified.at)}: ${action.verified.evidence}`)
      : node("p", "meta", `Plan ID ${action.actionId}. A handover is verified only after the EcoCart team has seen the collection receipt or the collector's confirmation.`),
    controls);
}

function renderTimeline() {
  const list = $("timeline");
  if (state.plansError) {
    list.replaceChildren(emptyState("Plans are offline", "Couldn't reach EcoCart's server. They will appear when the connection is back."));
    return;
  }
  const order = { planned: 0, done: 1, verified: 2 };
  const actions = periodActions().sort((a, b) => order[planStage(a).key] - order[planStage(b).key]
    || a.createdAt.localeCompare(b.createdAt));
  list.replaceChildren(...(actions.length
    ? actions.map(timelineItem)
    : [emptyState("No plans in this period", "Plan what happens to your old device from any device page on Amazon.in or Flipkart.")]));
}

// ---------- My comparisons ----------

function shortlistGroups() {
  const groups = new Map();
  for (const item of state.shortlist) {
    const group = compareGroup(item);
    if (group) groups.set(group, [...(groups.get(group) || []), item]);
  }
  return [...groups];
}

function groupHeading(items) {
  const [first] = items;
  if (first.kind === "device") {
    return [`${first.brand} ${DEVICE_WORDS[first.category]}s: lifecycle footprint the maker reports`,
      `Only ${first.brand}'s own reports are compared here, on the same basis.`];
  }
  return [`${first.type}: yearly electricity on the energy label`, "Only labels of the same type of appliance are compared."];
}

async function choose(chosen, instead) {
  const choice = makeChoice(chosen, instead, "chosen");
  if (!choice) {
    $("status").textContent = "Those two cannot be compared fairly, so nothing was recorded.";
    return;
  }
  await saveChoice(choice);
}

function choosePicker(item, items) {
  const others = items.filter((other) => other.key !== item.key && comparable(item, other));
  if (others.length === 0) return null;
  if (others.length === 1) return button("Chose this", () => choose(item, others[0]), "ghost");
  const wrap = node("div", "picker");
  const select = node("select");
  select.setAttribute("aria-label", `Chose ${item.name} instead of`);
  for (const other of others) {
    const option = node("option", "", other.name);
    option.value = other.key;
    select.append(option);
  }
  append(wrap, node("span", "eyebrow", "Instead of"), select,
    button("Chose this", () => choose(item, others.find((other) => other.key === select.value)), "ghost"));
  return wrap;
}

function groupCard([, items]) {
  const [title, rule] = groupHeading(items);
  const device = items[0].kind === "device";
  const value = (item) => (device ? item.carbonKg : item.kwhYear);
  const max = Math.max(...items.map(value));
  const chosenKeys = new Set(state.choices.filter((choice) => choice.stage !== "considered").map((choice) => choice.chosen.key));
  const card = append(node("div", "chart group"), node("p", "eyebrow", title));
  for (const item of [...items].sort((a, b) => value(a) - value(b))) {
    const track = node("div", "bar-track");
    const fill = node("div", "bar-fill");
    fill.style.width = `${Math.max(4, (value(item) / max) * 100)}%`;
    track.append(fill);
    const row = append(node("div", `bar-row${chosenKeys.has(item.key) ? " chosen" : ""}`),
      node("span", "bar-label", item.name), track,
      node("span", "bar-value", `${formatNumber(value(item), 1)} ${device ? "kg" : "kWh"}`));
    row.title = item.name;
    const actions = append(node("div", "row-actions"),
      chosenKeys.has(item.key) ? node("span", "pill done", "Chosen") : choosePicker(item, items),
      link(device ? item.carbonSource : item.url, device ? "Report" : "Listing"),
      button("Remove", () => removeFromShortlist(item.key), "ghost small"));
    card.append(row, actions);
  }
  card.append(node("p", "note", items.length < 2 ? `${rule} Shortlist another one to compare.` : rule));
  return card;
}

function laterCard(items) {
  const reasons = {
    product: "Has a category estimate only. It describes the category, not this product, so it is not compared.",
    device: "No reported footprint, so only its update support is compared below.",
    appliance: "Its listing states no yearly kWh, so there is nothing fair to compare.",
  };
  return append(node("div", "chart later"), node("p", "eyebrow", "Kept for later, not compared"),
    items.map((item) => append(node("div", "later-row"),
      append(node("p", ""), node("strong", "", item.name), ` ${item.shop}${item.price ? `, ₹${formatNumber(item.price)}` : ""}`),
      node("p", "muted", reasons[item.kind] || reasons.product),
      append(node("div", "row-actions"), link(item.url, "Open listing"), button("Remove", () => removeFromShortlist(item.key), "ghost small")))));
}

function renderGroups() {
  const groups = shortlistGroups();
  const later = state.shortlist.filter((item) => !compareGroup(item));
  const cards = groups.map(groupCard);
  if (later.length) cards.push(laterCard(later));
  $("groups").replaceChildren(...(cards.length ? cards
    : [emptyState("Nothing shortlisted yet", "Tap \"Add to my shortlist\" on any EcoCart card to compare products here.")]));
}

function choiceItem(choice) {
  const item = node("article", `choice-item ${choice.stage}`);
  const stage = node("select");
  stage.setAttribute("aria-label", "Stage");
  for (const key of CHOICE_STAGES) {
    const option = node("option", "", STAGE_LABELS[key]);
    option.value = key;
    option.selected = key === choice.stage;
    stage.append(option);
  }
  stage.addEventListener("change", () => setChoiceStage(choice.id, stage.value));
  const counted = choice.stage === "considered" ? "Not counted while you are considering it" : `Counted: ${formatNumber(choiceDifference(choice), 1)} ${choice.unit}`;
  return append(item,
    append(node("p", ""), ...choiceLine(choice)),
    append(node("div", "row-actions"), stage, node("span", "meta", counted),
      button("Undo", () => removeChoice(choice.id), "ghost small")));
}

function renderChoices() {
  const choices = periodChoices();
  $("choices").replaceChildren(...(choices.length ? choices.map(choiceItem)
    : [emptyState("No choices yet", "Choose a lower-footprint option on a device card, or pick between shortlisted products above.")]));
}

// "May 2031" -> Date, only for headlines that carry a sourced end date.
function supportEnd(device) {
  const match = /^(\w+) (\d{4})$/.exec(device.headline?.value || device.support || "");
  const month = match ? MONTHS.indexOf(match[1]) : -1;
  if ((!device.headline?.source && !device.support) || month < 0) return null;
  return new Date(Number(match[2]), month, 1);
}

function renderSupport() {
  const seen = new Map();
  for (const device of [...state.viewed, ...state.shortlist.filter((item) => item.kind === "device")]) {
    const end = supportEnd(device);
    const name = device.displayName || device.name;
    if (end && end > Date.now() && !seen.has(name)) seen.set(name, { name, years: (end - Date.now()) / (365.25 * 24 * 3600 * 1000) });
  }
  const rows = [...seen.values()].sort((a, b) => b.years - a.years);
  if (rows.length === 0) {
    $("support").replaceChildren(emptyState("No support dates yet", "Open phones, tablets or laptops on Amazon.in or Flipkart to compare them here."));
    return;
  }
  const max = Math.max(...rows.map((row) => row.years));
  const card = append(node("div", "chart"), node("p", "eyebrow", "Years of security updates left, at least"));
  for (const row of rows) {
    const track = node("div", "bar-track");
    const fill = node("div", "bar-fill");
    fill.style.width = `${Math.max(4, (row.years / max) * 100)}%`;
    track.append(fill);
    card.append(append(node("div", "bar-row"), node("span", "bar-label", row.name), track, node("span", "bar-value", `${row.years.toFixed(1)} yrs`)));
  }
  $("support").replaceChildren(card);
}

// ---------- My progress ----------

function activityDays() {
  const entries = periodActivity();
  let days;
  if (state.month === "all") {
    days = Array.from({ length: 30 }, (_, index) => {
      const day = new Date(Date.now() - (29 - index) * 86400000);
      return day.toISOString().slice(0, 10);
    });
  } else {
    const [year, month] = state.month.split("-").map(Number);
    const count = new Date(year, month, 0).getDate();
    days = Array.from({ length: count }, (_, index) => `${state.month}-${pad(index + 1)}`);
  }
  return days.map((day) => ({ day, entries: entries.filter((entry) => entry.at.slice(0, 10) === day) }));
}

function renderActivity() {
  const days = activityDays();
  const max = Math.max(1, ...days.map((day) => day.entries.length));
  const chart = node("div", "columns");
  chart.setAttribute("role", "list");
  for (const { day, entries } of days) {
    const column = node("button", `column${state.selectedDay === day ? " selected" : ""}`);
    column.type = "button";
    column.setAttribute("aria-label", `${formatDay(day)}: ${entries.length} actions`);
    const stack = node("span", "stack");
    stack.style.height = `${(entries.length / max) * 100}%`;
    for (const type of Object.keys(ACTIVITY_TYPES)) {
      const count = entries.filter((entry) => entry.type === type).length;
      if (!count) continue;
      const part = node("span", `part ${type}`);
      part.style.flexGrow = String(count);
      stack.append(part);
    }
    column.append(stack, node("span", "column-day", day.slice(8)));
    column.addEventListener("click", () => {
      state.selectedDay = day;
      renderActivity();
    });
    chart.append(column);
  }
  const legend = append(node("div", "legend"), Object.entries(ACTIVITY_TYPES)
    .filter(([, info]) => shows(info.group))
    .map(([type, info]) => append(node("span", "legend-item"), node("span", `swatch ${type}`), info.label)));
  const total = days.reduce((sum, day) => sum + day.entries.length, 0);
  $("activity-chart").replaceChildren(
    node("p", "eyebrow", state.month === "all" ? `Last 30 days: ${total} actions` : `${monthLabel(state.month)}: ${total} actions`),
    chart, legend);

  const selected = days.find((day) => day.day === state.selectedDay);
  $("activity-day").replaceChildren(...(selected
    ? [node("p", "eyebrow", formatDay(selected.day)), itemList(selected.entries.map((entry) =>
      [node("span", `swatch ${entry.type}`), ` ${ACTIVITY_TYPES[entry.type]?.label || entry.type}: `, node("strong", "", entry.name || "a product")]))]
    : [node("p", "muted", "Tap a day to see what you did.")]));
}

// ---------- Filters and tabs ----------

function renderMonthOptions() {
  const months = new Set([
    ...state.actions.flatMap((action) => [action.createdAt, action.doneAt, action.verified?.at]),
    ...state.choices.map((choice) => choice.updatedAt),
    ...state.activity.map((entry) => entry.at),
  ].filter(Boolean).map(monthKey));
  const select = $("month-filter");
  const current = select.value;
  select.replaceChildren(append(node("option", "", "All time"), []), ...[...months].sort().reverse().map((key) => {
    const option = node("option", "", monthLabel(key));
    option.value = key;
    return option;
  }));
  select.firstChild.value = "all";
  select.value = [...select.options].some((option) => option.value === current) ? current : "all";
  state.month = select.value;
}

function selectTab(name) {
  state.tab = name;
  for (const tab of document.querySelectorAll(".tab")) {
    const selected = tab.id === `tab-${name}`;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
  }
  for (const panel of document.querySelectorAll(".panel")) panel.hidden = panel.id !== `panel-${name}`;
}

function renderAll() {
  renderMonthOptions();
  renderPlant($("plant"), state.actions.filter((action) => action.status === "done").length);
  renderNext();
  renderAllTime();
  renderOverview();
  renderTimeline();
  renderGroups();
  renderChoices();
  renderSupport();
  renderActivity();
  markLive();
  state.justChanged = null;
}

// ---------- Wiring ----------

for (const tab of document.querySelectorAll(".tab")) {
  tab.addEventListener("click", () => selectTab(tab.id.replace("tab-", "")));
  tab.addEventListener("keydown", (event) => {
    const tabs = [...document.querySelectorAll(".tab")];
    const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!step) return;
    const next = tabs[(tabs.indexOf(tab) + step + tabs.length) % tabs.length];
    next.focus();
    next.click();
  });
}
$("month-filter").addEventListener("change", (event) => {
  state.month = event.target.value;
  state.selectedDay = null;
  renderAll();
});
$("type-filter").addEventListener("change", (event) => {
  state.type = event.target.value;
  renderAll();
});
$("drawer-close").addEventListener("click", closeDrawer);
$("drawer").addEventListener("click", (event) => {
  if (event.target.id === "drawer") closeDrawer();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("drawer").hidden) closeDrawer();
});
$("backup").addEventListener("click", async () => {
  const data = await chrome.storage.local.get(BACKUP_KEYS);
  const backup = { app: "EcoCart", version: 1, savedAt: new Date().toISOString(), data };
  downloadFile(`ecocart-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(backup, null, 2), "application/json");
});
$("restore").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  event.target.value = "";
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (backup?.app !== "EcoCart" || typeof backup.data !== "object") throw new Error("Not an EcoCart backup");
    const data = Object.fromEntries(Object.entries(backup.data).filter(([key]) => BACKUP_KEYS.includes(key)));
    await chrome.storage.local.set({ ...data, [PLANS_CHANGED_KEY]: Date.now() });
    $("status").textContent = `Restored the backup from ${formatDay(backup.savedAt)}.`;
  } catch {
    $("status").textContent = "That file is not an EcoCart backup, so nothing was changed.";
  }
});
$("clear-history").addEventListener("click", async () => {
  await chrome.storage.local.remove([ACTIVITY_KEY, VIEWED_KEY]);
});

// Live: anything the card or popup changes shows up here at once; plans are re-read from the server as well.
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== "local") return;
  const keys = Object.keys(changes);
  if (keys.includes(PLANS_CHANGED_KEY)) await loadPlans();
  if (keys.some((key) => LOCAL_KEYS.has(key))) await loadLocal();
  if (keys.includes(PLANS_CHANGED_KEY) || keys.some((key) => LOCAL_KEYS.has(key))) renderAll();
});
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible") return;
  await loadPlans();
  renderAll();
});
setInterval(async () => {
  if (document.visibilityState !== "visible") return;
  await loadPlans();
  renderAll();
}, PLAN_REFRESH_MS);

(async () => {
  selectTab(new URLSearchParams(location.search).get("tab") || "overview");
  await Promise.all([loadLocal(), loadPlans(), loadGridFactor()]);
  renderAll();
  if (state.plansError) $("status").textContent = "Couldn't load your plans. Check your connection.";
})();
