// "Try the whole journey": choose between two real products, see why and what EcoCart does not compare, record a
// sample choice and watch a sample dashboard update, then undo it. Nothing here is saved or sent, and nothing counts
// in the live totals. Phone figures come live from the EcoCart API; the fridge listings were saved on the date shown.
// config.js (written at deploy) sets window.ECOCART_API.

const demoBox = document.getElementById("demo-stage");

// Two fridges of the same type and about the same size, with the yearly use their Amazon.in listings state.
const FRIDGES = {
  checked: "2026-10-11",
  a: { name: "Whirlpool 235 L, 3 star, frost free, double door", price: 27990, capacity: "235 litres", stars: 3, kwh: 192,
    url: "https://www.amazon.in/dp/B0GHMN7MY8" },
  b: { name: "Haier 237 L, 2 star, frost free, double door", price: 25690, capacity: "237 litres", stars: 2, kwh: 230,
    url: "https://www.amazon.in/dp/B0GP76MN24" },
};

const demo = { mode: "phone", phone: null, factors: [], chosen: false, rate: null };
const MAX_RATE = 50;

function make(tag, className, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function anchor(url, label) {
  const link = make("a", "", `${label} ↗`);
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function pill(label, onClick, variant = "light") {
  const button = make("button", `pill-btn ${variant}`, label);
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
}

const inr = (value) => `₹${Number(value).toLocaleString("en-IN")}`;
const num = (value, digits = 0) => Number(value).toLocaleString("en-IN", { maximumFractionDigits: digits });
const day = (text) => new Date(text).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

async function api(path) {
  const response = await fetch(`${window.ECOCART_API}${path}`);
  if (!response.ok) throw new Error(`status ${response.status}`);
  return response.json();
}

async function loadPhones() {
  const current = await api("/products/apple-iphone-18-pro?price=164900");
  const lower = current.lowerFootprint;
  if (!lower) throw new Error("No lower-footprint option today");
  const other = await api(`/products/${encodeURIComponent(lower.modelId)}?price=${lower.price.value}`);
  const { factors } = await api("/factors");
  demo.factors = factors;
  demo.phone = { current, other, lower };
}

function column(title, rows, badge) {
  return make("div", "demo-col",
    badge ? make("span", "demo-badge", badge) : null,
    make("p", "demo-name", title),
    make("dl", "demo-facts", rows.map(([label, value, meta]) => make("div", "", make("dt", "", label), make("dd", "", value, meta ? make("span", "demo-meta", meta) : null)))));
}

function phoneCompare() {
  const { current, other, lower } = demo.phone;
  const support = (card) => card.scorecard?.support?.value || card.headline?.value || "Not published";
  const carbon = (card) => (card.carbon ? `${num(card.carbon.kg)} kg CO₂e` : "Not published");
  const basis = (card) => card.carbon?.basis || null;
  const difference = Math.round((current.carbon.kg - lower.kg) * 10) / 10;
  return {
    difference,
    unit: "kg CO₂e",
    columns: [
      column(current.product.displayName, [
        ["Price", "₹1,64,900", "on the sample listing"],
        ["Security updates", `Until at least ${support(current)}`],
        ["Footprint Apple reports", carbon(current), basis(current)],
      ], "You are looking at"),
      column(other.product.displayName, [
        ["Price", inr(lower.price.value), `checked ${day(lower.price.checked)}`],
        ["Security updates", `Until at least ${support(other)}`],
        ["Footprint Apple reports", carbon(other), basis(other)],
      ], "Worth checking"),
    ],
    why: `Apple reports ${num(difference, 1)} kg CO₂e less for the ${other.product.displayName}, at a similar price, on the same basis.`,
    tradeoff: "A lower footprint alone does not make it the right phone. EcoCart does not compare cameras, battery, size or storage options, so check those suit you.",
    sources: [anchor(lower.carbonSource, "Apple's report"), " ", anchor(lower.price.source, "Price")],
    choose: `Choose the ${other.product.displayName}`,
  };
}

// The running cost at the rate the visitor types from their bill, as in the extension. No rate is assumed.
function rateBlock(a, b) {
  const output = make("p", "demo-why");
  const input = document.createElement("input");
  Object.assign(input, { type: "number", min: "0.1", max: String(MAX_RATE), step: "0.1", placeholder: "From your bill", className: "demo-rate-input" });
  input.inputMode = "decimal";
  input.setAttribute("aria-label", "Your electricity rate in rupees per unit");
  if (demo.rate) input.value = String(demo.rate);
  const show = () => {
    const rate = Number(input.value);
    if (!(rate > 0 && rate <= MAX_RATE)) {
      output.textContent = "Type your rate per unit (kWh) from your electricity bill to see the running cost. EcoCart does not assume one.";
      return;
    }
    demo.rate = rate;
    const costA = Math.round(a.kwh * rate);
    const costB = Math.round(b.kwh * rate);
    const upfront = a.price - b.price;
    const payback = costB > costA && upfront > 0 ? Math.round((upfront / (costB - costA)) * 10) / 10 : null;
    output.textContent = `At ${inr(rate)} a unit, the Whirlpool costs about ${inr(costA)} a year to run and the Haier about ${inr(costB)}: ${inr(costB - costA)} a year less.`
      + (payback ? ` Its ${inr(upfront)} higher price is repaid in about ${num(payback, 1)} years of use.` : "");
  };
  input.addEventListener("input", show);
  show();
  return make("div", "demo-rate",
    make("label", "demo-rate-field", make("span", "demo-step-label", "Your electricity rate, ₹ per unit"), input),
    output);
}

function fridgeCompare() {
  const { a, b, checked } = FRIDGES;
  const grid = demo.factors.find((factor) => factor.factorId === "india-grid-kwh");
  const difference = b.kwh - a.kwh;
  const yearlyKg = grid ? Math.round(difference * grid.kgCo2ePerUnit) : null;
  return {
    difference,
    unit: "kWh a year",
    columns: [
      column(b.name, [["Price", inr(b.price)], ["Capacity", b.capacity], ["Label", `${b.stars} stars, ${b.kwh} kWh a year`]], "You are looking at"),
      column(a.name, [["Price", inr(a.price)], ["Capacity", a.capacity], ["Label", `${a.stars} stars, ${a.kwh} kWh a year`]], "On your shortlist"),
    ],
    why: `The Whirlpool's label says ${difference} kWh a year less${yearlyKg ? `, about ${yearlyKg} kg CO₂e a year on India's grid` : ""}. Same type, sizes within 1%, both measured under BEE's standard test.`,
    tradeoff: `It costs ${inr(a.price - b.price)} more. Real use depends on how you use it, and the saving repeats every year it runs. Listings saved on ${day(checked)}.`,
    sources: [anchor(a.url, "Whirlpool listing"), " ", anchor(b.url, "Haier listing"), grid ? [" ", anchor(grid.source, "Grid factor")] : null],
    extra: rateBlock(a, b),
    choose: "Choose the Whirlpool",
  };
}

function sampleDashboard(compare) {
  const amount = demo.chosen ? compare.difference : 0;
  const isPhone = demo.mode === "phone";
  const number = make("span", `demo-number${demo.chosen ? " changed" : ""}`, num(amount, 1));
  const chart = make("div", "demo-chart", make("span", "demo-step", ""));
  chart.firstChild.style.height = demo.chosen ? "70%" : "0%";
  return make("div", "demo-dash",
    make("p", "demo-dash-label", "Sample dashboard. Nothing is saved, and it never counts in the live totals."),
    make("div", "demo-dash-row",
      make("div", "",
        make("p", "demo-dash-title", isPhone ? "Possible difference" : "Electricity difference"),
        make("p", "demo-figure", number, make("span", "", ` ${compare.unit}`)),
        make("p", "demo-dash-note", demo.chosen
          ? (isPhone ? "Chosen. When you buy it, tap \"I bought this\" on the card or confirm it on the order page, and it moves to your purchases." : "Counted separately from phones: it repeats every year the fridge runs.")
          : "Nothing chosen yet.")),
      chart),
    demo.chosen ? pill("Undo the choice", () => { demo.chosen = false; render(); }, "outline") : null);
}

function render() {
  if (demo.mode === "phone" && !demo.phone) {
    demoBox.replaceChildren(make("p", "demo-note", "EcoCart's API could not be reached just now, so the phone example is not shown. Try the fridge example."));
    return;
  }
  const compare = demo.mode === "phone" ? phoneCompare() : fridgeCompare();
  demoBox.replaceChildren(
    make("div", "demo-steps",
      make("p", "demo-step-label", "1. Two products"),
      make("div", "demo-cols", compare.columns),
      make("p", "demo-step-label", "2. Why, and what to weigh"),
      make("p", "demo-why", compare.why),
      make("p", "demo-tradeoff", compare.tradeoff),
      compare.extra || null,
      make("p", "demo-sources", compare.sources),
      make("p", "demo-step-label", "3. Your choice"),
      demo.chosen
        ? make("p", "demo-why", "Recorded in the sample dashboard on the right.")
        : pill(compare.choose, () => { demo.chosen = true; render(); })),
    sampleDashboard(compare));
}

function setMode(mode) {
  demo.mode = mode;
  demo.chosen = false;
  for (const tab of document.querySelectorAll(".demo-tab")) tab.setAttribute("aria-selected", String(tab.dataset.mode === mode));
  render();
}

(async () => {
  for (const tab of document.querySelectorAll(".demo-tab")) tab.addEventListener("click", () => setMode(tab.dataset.mode));
  for (const button of document.querySelectorAll("[data-demo]")) {
    button.addEventListener("click", () => {
      document.getElementById("demo").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      setMode(button.dataset.demo);
    });
  }
  demoBox.replaceChildren(make("p", "demo-note", "Loading the live example..."));
  try {
    await loadPhones();
  } catch {
    demo.phone = null;
    try {
      demo.factors = (await api("/factors")).factors;
    } catch {
      demo.factors = [];
    }
  }
  render();
})();
