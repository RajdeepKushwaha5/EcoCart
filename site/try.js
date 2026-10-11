// "Try EcoCart" and the use-case journeys. Saved sample listings are sent to the live EcoCart API, and the answer
// is drawn the way the extension's card draws it: what we know, what it means, what you can do.
// config.js (written at deploy) sets window.ECOCART_API.

const tryList = document.getElementById("try-list");
const tryResult = document.getElementById("try-result");
const TIPS = {
  Phone: ["Using a phone for longer is the biggest saving: most of its footprint comes from making it.",
    "A new battery usually costs far less than a new phone."],
  Grocery: ["Buy what you will use. Food that goes to waste wastes everything that went into making it.",
    "Refill packs and bigger packs usually use less packaging for the same amount."],
  Clothing: ["Wear it often and keep it longer.", "Wash cooler and line dry to save electricity.",
    "Second-hand clothes avoid a new garment being made."],
};

let samples = [];
let checked = null;
let runId = 0;

function el(tag, className, ...children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function link(url, label = "Source") {
  if (!url) return null;
  const anchor = el("a", "", `${label} ↗`);
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  return anchor;
}

function rupees(value) {
  return `₹${Number(value).toLocaleString("en-IN")}`;
}

function number(value) {
  return Number(value).toLocaleString("en-IN");
}

function formatDay(text) {
  const [year, month, day] = String(text).split("-").map(Number);
  return new Date(year, month - 1, day || 1).toLocaleDateString("en-IN", { day: day ? "numeric" : undefined, month: "short", year: "numeric" });
}

async function call(method, path, body) {
  const response = await fetch(`${window.ECOCART_API}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`status ${response.status}`);
  return response.json();
}

function step(number, title, ...children) {
  const content = children.flat().filter(Boolean);
  if (content.length === 0) return null;
  return el("section", "try-step", el("header", "try-step-head", el("span", "try-step-num", number), el("h3", "", title)), el("div", "try-step-body", content));
}

function fact(label, value, ...meta) {
  return el("div", "try-fact", el("p", "try-fact-label", label), el("div", "", el("p", "try-fact-value", value), el("p", "try-meta", meta)));
}

function rangeBar(position, low, high) {
  if (position === null || position === undefined) return null;
  const mark = el("span", "range-mark");
  mark.style.left = `${position * 100}%`;
  return el("div", "range", el("span", "range-track", mark), el("span", "range-ends", el("span", "", low), el("span", "", high)));
}

// ---------- A device: the passport ----------

async function deviceAnswer(sample) {
  const match = await call("POST", "/match", { title: sample.title, details: {}, category: sample.category });
  if (!match.modelId) {
    return [step("01", "What we know", el("p", "try-lede", "No official figures for this phone yet. EcoCart only shows what the maker has published."))];
  }
  const card = await call("GET", `/products/${encodeURIComponent(match.modelId)}?price=${sample.price}`);
  const support = card.scorecard?.support;
  const footprint = card.scorecard?.footprint;
  const know = [
    el("p", "try-lede", card.explanation),
    fact("Security updates", support ? `Until at least ${support.value}` : card.headline.value, link(card.headline.source, "Official policy")),
    card.carbon
      ? fact("Reported footprint", `${number(card.carbon.kg)} kg CO₂e`, `Reported by ${card.product.brand}`, card.carbon.basis ? `, ${card.carbon.basis}. ` : ". ", link(card.carbon.source))
      : fact("Reported footprint", `Not published by ${card.product.brand}`),
  ];
  const means = [
    support && support.position != null
      ? el("div", "try-fact-wide", el("p", "try-fact-label", `Update support against ${support.count} phones in EcoCart's list`), rangeBar(support.position, support.low, support.high))
      : null,
    footprint && footprint.position != null
      ? el("div", "try-fact-wide", el("p", "try-fact-label", `Footprint against ${footprint.count} ${footprint.brand} phones (only one maker is compared)`),
        rangeBar(footprint.position, `${footprint.low} kg`, `${footprint.high} kg`))
      : null,
    card.carbon?.equivalents?.length
      ? el("ul", "try-equivalents", card.carbon.equivalents.map((item) => el("li", "", el("strong", "", `≈ ${number(item.amount)}`), ` ${item.unit} `, link(item.source, "Factor"))))
      : null,
  ];
  const lower = card.lowerFootprint;
  const can = [
    lower
      ? el("div", "try-option", el("p", "try-option-kind", "Same maker, similar price, lower footprint"), el("p", "try-option-title", lower.displayName),
        el("p", "", lower.reason), el("p", "try-meta", `${rupees(lower.price.value)} as of ${formatDay(lower.price.checked)}. `, link(lower.carbonSource, "Report")),
        el("p", "try-hint", "In the extension: \"I'll choose this instead\" records the choice in your dashboard."))
      : null,
    card.alternative
      ? el("div", "try-option", el("p", "try-option-kind", "Similar price, longer support"), el("p", "try-option-title", card.alternative.displayName), el("p", "", card.alternative.reason))
      : null,
    el("div", "try-option", el("p", "try-option-kind", "Your old phone"), el("p", "try-option-title", "Plan where it goes"),
      el("p", "", "Exchange, resale and recycling routes from each company's own page, in seven Indian cities. Mark it done when it is handed over.")),
    tips(sample.kind),
  ];
  return [step("01", "What we know", know), step("02", "What this means", means), step("03", "What you can do", can)];
}

// ---------- Anything else: a labelled category estimate ----------

async function estimateAnswer(sample) {
  const result = await call("POST", "/estimate", { title: sample.title, crumbs: sample.crumbs, price: sample.price });
  const estimate = result.estimate;
  if (!estimate) {
    return [step("01", "What we know", el("p", "try-lede", "No estimate for this product yet: EcoCart could not match its category."))];
  }
  const equivalent = estimate.equivalents?.[0];
  const rank = estimate.perRupee;
  const know = [
    el("p", "try-flag", "Category estimate, not measured for this product"),
    el("p", "try-big", el("span", "try-approx", "About "), number(estimate.kg), el("span", "try-unit", " kg CO₂e")),
    el("p", "", `Typical for ${estimate.category.toLowerCase()} at this price in India: ${rupees(estimate.priceInr)} × about ${estimate.kgPerThousandInr} kg CO₂e per ₹1,000, the Open CEDA average for "${estimate.sector.name}".`),
    el("p", "try-meta", "Covers making the product up to the factory gate. ", link(estimate.dataset.source, "Dataset")),
    sample.labels.length
      ? fact("Labels on the listing", sample.labels.join(", "), "Stated by the seller, not checked by EcoCart.")
      : null,
  ];
  const means = [
    equivalent ? el("p", "try-lede small", `Roughly the same as ${number(equivalent.amount)} ${equivalent.unit}.`) : null,
    el("div", "try-fact-wide", el("p", "try-fact-label", `${estimate.category} among the ${rank.count} product types EcoCart covers, per rupee spent`),
      rangeBar(rank.position, `${rank.lowest} kg`, `${rank.highest} kg`)),
    el("p", "try-meta", "This describes the category, not this product. A specific product can be well above or below it."),
  ];
  return [step("01", "What we know", know), step("02", "What this means", means),
    step("03", "What you can do", tips(sample.kind), el("p", "try-hint", "In the extension: add it to your shortlist, and look for refills or 5 star appliances where they apply."))];
}

function tips(kind) {
  return el("div", "try-option", el("p", "try-option-kind", "General tips, not specific to this product"),
    el("ul", "try-tips", (TIPS[kind] || TIPS.Grocery).map((tip) => el("li", "", tip))));
}

// ---------- Wiring ----------

function frame(sample, ...content) {
  return el("div", "try-card",
    el("header", "try-bar", el("span", "try-logo", el("span", "try-dot"), "EcoCart"),
      el("span", "try-tag", sample.category ? "Phone passport" : "Footprint estimate"),
      el("span", "try-sample", "Interactive sample")),
    el("div", "try-body", content),
    el("p", "try-foot", `Listing saved from ${sample.shop} on ${formatDay(checked)}: "${sample.title.slice(0, 90)}", ${rupees(sample.price)}. `,
      link(sample.url, "Open the listing"), " Answer from the live EcoCart API."));
}

async function showSample(id) {
  const sample = samples.find((item) => item.id === id);
  if (!sample) return;
  const run = ++runId;
  for (const button of tryList.querySelectorAll("button")) button.setAttribute("aria-pressed", String(button.dataset.id === id));
  tryResult.replaceChildren(frame(sample, el("div", "try-loading", el("span", ""), el("span", ""), el("span", ""))));
  let content;
  try {
    content = sample.category ? await deviceAnswer(sample) : await estimateAnswer(sample);
  } catch {
    content = [el("p", "try-lede", "EcoCart's API could not be reached just now. Nothing is shown rather than a guess. Try again in a moment.")];
  }
  if (run === runId) tryResult.replaceChildren(frame(sample, content));
}

function renderList() {
  tryList.replaceChildren(...samples.map((sample) => {
    const button = el("button", "try-pick", el("span", "try-pick-kind", `${sample.kind} · ${sample.shop}`),
      el("span", "try-pick-name", sample.name), el("span", "try-pick-price", rupees(sample.price)));
    button.type = "button";
    button.dataset.id = sample.id;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => showSample(sample.id));
    return button;
  }));
}

function setUpUseCases() {
  const tabs = [...document.querySelectorAll(".case-tab")];
  const select = (tab) => {
    for (const other of tabs) {
      const selected = other === tab;
      other.setAttribute("aria-selected", String(selected));
      other.tabIndex = selected ? 0 : -1;
      document.getElementById(other.getAttribute("aria-controls")).hidden = !selected;
    }
  };
  for (const tab of tabs) {
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (event) => {
      const move = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (!move) return;
      const next = tabs[(tabs.indexOf(tab) + move + tabs.length) % tabs.length];
      next.focus();
      select(next);
    });
  }
  for (const button of document.querySelectorAll("[data-try]")) {
    button.addEventListener("click", () => {
      document.getElementById("try").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      showSample(button.dataset.try);
    });
  }
}

(async () => {
  setUpUseCases();
  try {
    const data = await (await fetch("samples.json")).json();
    samples = data.samples;
    checked = data.checked;
  } catch {
    tryResult.replaceChildren(el("p", "try-lede", "The samples could not be loaded."));
    return;
  }
  renderList();
  showSample(samples[1]?.id || samples[0].id);
})();
