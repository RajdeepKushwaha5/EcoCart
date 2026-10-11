// The "Before you buy" scorecard and the "Better options" list. Both show only what we can back up:
// sourced facts, the listing's own labels, and real listings found on the shop. Nothing is combined into a score.

const PLANNED_KEY = "plannedFor";
// Written whenever a plan changes, so an open dashboard refreshes at once.
const PLANS_CHANGED_KEY = "plansChangedAt";
const REFILL_SECTORS = new Set(["325610", "325620"]);
const KWH_LABEL = /energy consumption|power consumption|annual consumption/i;

let fullCatalog = null;
let factorsRequest = null;

// ---------- Shared bits ----------

// A short product name for shop searches: the title up to the first separator, at most eight words.
// Stops before filler that shops add after the model: "Galaxy S25 Ultra 5G AI Smartphone" becomes "Galaxy S25 Ultra".
const NAME_FILLER = /\s+(?:with|for|[45]g|ai|smart ?phone|mobile phone|smart ?watch|laptop|true wireless)\b.*$/i;

function shortName(title) {
  const head = clean(title.split(/[|,(:]| - /)[0]);
  const trimmed = head.replace(NAME_FILLER, "");
  return (trimmed.split(" ").length >= 2 ? trimmed : head).split(" ").slice(0, 8).join(" ");
}

function shopSearchLink(query, label) {
  return el("a", { href: SITE.searchUrl(query), target: "_blank", rel: "noopener noreferrer" }, `${label} ${ARROW}`);
}

function loadFullCatalog() {
  fullCatalog ??= api("GET", "/catalog").then(({ products }) => products).catch(() => {
    fullCatalog = null;
    return [];
  });
  return fullCatalog;
}

function loadFactors() {
  factorsRequest ??= api("GET", "/factors").then(({ factors }) => factors).catch(() => {
    factorsRequest = null;
    return [];
  });
  return factorsRequest;
}

async function hasPlan(key) {
  const stored = await chrome.storage.local.get(PLANNED_KEY);
  return Boolean(stored[PLANNED_KEY]?.includes(key));
}

async function rememberPlan(key) {
  const stored = await chrome.storage.local.get(PLANNED_KEY);
  const keys = [key, ...(stored[PLANNED_KEY] || []).filter((item) => item !== key)].slice(0, 50);
  await chrome.storage.local.set({ [PLANNED_KEY]: keys });
}

// Opens the dashboard in a new tab. Pages on the shop cannot link to extension pages directly.
function dashboardLink(label, tab = null) {
  return el("button", { className: "text-btn", type: "button",
    onClick: () => chrome.runtime.sendMessage({ type: "openDashboard", tab }) }, `${label} ${ARROW}`);
}

// ---------- Shortlist ----------

// What the dashboard needs to compare this product later. Catalog devices are keyed by model, so the same phone on
// Amazon and Flipkart is one entry.
function shortlistItem(page, card, category, estimate = null) {
  const kwhYear = annualKwh(page.details);
  const base = {
    key: card ? `model:${card.product.modelId}` : `${SITE.name.toLowerCase()}:${SITE.listingId()}`,
    shop: SITE.name,
    url: SITE.productUrl(),
    name: (card?.product.displayName || page.title).slice(0, 150),
    price: page.price,
    type: clean(page.crumbs[page.crumbs.length - 1] || "").toLowerCase() || null,
    kwhYear,
    capacity: capacityFrom(page.details),
    stars: energyStars(page),
  };
  if (kwhYear != null && (!category || category === "appliance" || category === "tv")) {
    return { ...base, kind: "appliance", category: category || null };
  }
  if (category) {
    return {
      ...base,
      kind: "device",
      category,
      brand: card?.product.brand || clean(page.details.Brand || "") || null,
      modelId: card?.product.modelId || null,
      carbonKg: card?.carbon?.kg ?? null,
      carbonBasis: card?.carbon?.basis || null,
      carbonSource: card?.carbon?.source || null,
      support: card?.headline?.source ? card.headline.value : null,
    };
  }
  return { ...base, kind: "product", estimateKg: estimate?.kg ?? null, estimateCategory: estimate?.category ?? null };
}

function shortlistHint(item) {
  if (item.kind === "device" && item.carbonKg != null) {
    return `Shortlist other ${item.brand} ${DEVICE_WORDS[item.category]}s to compare reported footprints. Makers measure differently, so only one maker is compared.`;
  }
  if (item.kind === "appliance") return "Shortlist others of this type with a stated yearly kWh to compare electricity use.";
  if (item.kind === "device") return "Kept for later. With no published footprint, it is compared on update support only.";
  return "Kept for later. A category estimate describes the category, so two products are not compared by it.";
}

function shortlistControl(item) {
  const wrap = el("div", { className: "shortlist" });
  const render = async () => {
    if (await isShortlisted(item.key)) {
      show(wrap, el("p", { className: "shortlist-state" }, el("span", { className: "tick", "aria-hidden": "true" }), "On your shortlist"),
        el("div", { className: "row" }, dashboardLink("Compare in your dashboard"),
          el("button", { className: "text-btn", type: "button", onClick: async () => { await removeFromShortlist(item.key); render(); } }, "Remove")));
      return;
    }
    show(wrap, button("Add to my shortlist", async () => { await addToShortlist(item); render(); }, "ghost"),
      el("p", { className: "note" }, shortlistHint(item)));
  };
  render();
  // A choice made further down the card also shortlists this product, so the button follows the stored list.
  const onChange = (changes, area) => {
    if (!wrap.isConnected) {
      chrome.storage.onChanged.removeListener(onChange);
      return;
    }
    if (area === "local" && changes[SHORTLIST_KEY]) render();
  };
  chrome.storage.onChanged.addListener(onChange);
  return wrap;
}

// A moment of thanks when the shopper picks the lower-footprint option. The plant grows with each greener choice.
async function celebrateChoice(anchor, chosen, difference) {
  const card = anchor.getRootNode().querySelector(".card");
  if (!card) return;
  const choices = await loadChoices();
  const grown = choices.filter((choice) => choice.stage === "chosen" || choice.stage === "purchased").length;
  const { stage, name } = plantStage(grown);
  const art = el("div", { className: "celebrate-plant" });
  art.innerHTML = plantSvg(stage); // Fixed shapes only, no page data.
  const close = () => overlay.remove();
  const overlay = el("div", { className: "celebrate", role: "dialog", "aria-label": "Nice choice" },
    el("div", { className: "celebrate-panel" },
      el("button", { className: "celebrate-close", type: "button", "aria-label": "Close", onClick: close }, "×"),
      art,
      el("p", { className: "celebrate-title" }, "Woah, nice choice!"),
      el("p", { className: "celebrate-text" }, `You picked the ${chosen.name}: ${difference} less, by ${chosen.brand}'s own reports. Your plant is now: ${name}.`),
      el("p", { className: "celebrate-quote" }, "\u201cThe greatest threat to our planet is the belief that someone else will save it.\u201d Robert Swan"),
      button("Keep shopping", close, "primary")));
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  card.append(overlay);
  overlay.querySelector(".btn").focus();
}

// Records that the shopper picked one product over a comparable one. Nothing is recorded for an unfair comparison.
function choiceControls(chosen, instead, difference) {
  const status = el("p", { className: "note", role: "status" });
  const record = (stage) => async () => {
    const choice = makeChoice(chosen, instead, stage);
    if (!choice) {
      status.textContent = "These two cannot be compared fairly, so nothing was recorded.";
      return;
    }
    await addToShortlist(instead);
    await addToShortlist(chosen);
    await saveChoice(choice);
    if (stage === "chosen") celebrateChoice(status, chosen, difference);
    status.replaceChildren(stage === "chosen"
      ? `Recorded: you chose the ${chosen.name}. By ${chosen.brand}'s own reports, that is ${difference} less. `
      : "Both are on your shortlist, side by side. ",
    stage === "chosen" ? dashboardLink("See your total") : dashboardLink("Compare them", "comparisons"));
  };
  return el("div", { className: "choice" },
    el("div", { className: "row" },
      button("I'll choose this instead", record("chosen"), "primary"),
      button("Compare these phones", record("considered"), "ghost")),
    status);
}

// ---------- Appliances ----------

// What an appliance's label says, and how it compares with a shortlisted one of the same type and size.
async function applianceFacts(page, item) {
  const stars = energyStars(page);
  const kwh = item.kwhYear;
  const grid = kwh ? (await loadFactors()).find((factor) => factor.factorId === "india-grid-kwh") : null;
  const lines = [];
  if (stars || kwh) {
    const parts = [stars ? `${stars} of 5 BEE stars` : null, kwh ? `${formatNumber(kwh)} kWh a year` : null].filter(Boolean);
    lines.push(el("div", { className: "decide-fact" },
      el("p", { className: "decide-text" }, `The label says ${parts.join(", ")}`,
        grid && kwh ? `, about ${formatNumber(Math.round(kwh * grid.kgCo2ePerUnit))} kg CO₂e a year on India's grid.` : "."),
      el("p", { className: "meta" }, "As stated on this listing", grid ? [DOT, sourceLink(grid.source, "Grid factor")] : null)));
  }
  if (!kwh) return { lines, compare: null };
  const others = (await loadShortlist()).filter((other) => comparable(item, other) || comparable(other, item));
  lines.push(await tariffBlock(item, others));
  if (others.length === 0) {
    return { lines, compare: el("p", { className: "decide-text" },
      `Add it to your shortlist, then open another ${item.type || "appliance"} of about the same size: EcoCart compares their yearly electricity use.`) };
  }
  const rows = others.map((other) => {
    const difference = other.kwhYear - kwh;
    const verdict = difference > 0
      ? `uses ${formatNumber(difference)} kWh a year more than this one`
      : difference < 0 ? `uses ${formatNumber(-difference)} kWh a year less than this one` : "uses the same as this one";
    return el("p", { className: "decide-text" }, el("strong", {}, shortName(other.name)), `, on your shortlist, ${verdict}.`);
  });
  return { lines, compare: el("div", { className: "decide-option" }, rows,
    el("p", { className: "tradeoff" }, "Both labels use BEE's standard test, so real use depends on how you use it. Check capacity, features and price too.")) };
}

// What it costs to run at the shopper's own rate, against comparable shortlisted ones. Nothing is shown until they
// type a rate: EcoCart does not guess one.
async function tariffBlock(item, others) {
  const output = el("div", { className: "tariff-output", "aria-live": "polite" });
  const input = el("input", { type: "number", min: "0.1", max: String(MAX_TARIFF), step: "0.1", inputmode: "decimal",
    name: "tariff", placeholder: "From your bill", "aria-label": "Your electricity rate in rupees per unit" });
  const render = (rate) => {
    if (!rate) {
      output.replaceChildren(el("p", { className: "meta" }, "Type your rate per unit (kWh) from your electricity bill to see the running cost."));
      return;
    }
    const own = runningCost(item.kwhYear, null, rate);
    const rows = others.map((other) => {
      const cost = runningCost(item.kwhYear, other.kwhYear, rate, item.price, other.price);
      const run = cost.savedPerYear > 0 ? `costs about ${formatRupees(cost.savedPerYear)} a year less to run`
        : cost.savedPerYear < 0 ? `costs about ${formatRupees(-cost.savedPerYear)} a year more to run` : "costs the same to run";
      const upfront = cost.upfront == null ? "" : cost.upfront > 0 ? `, and ${formatRupees(cost.upfront)} more to buy`
        : cost.upfront < 0 ? `, and ${formatRupees(-cost.upfront)} less to buy` : ", and the same to buy";
      const payback = cost.payback != null ? ` The extra price is repaid in about ${formatNumber(cost.payback)} years of use.` : "";
      return el("p", { className: "decide-text" }, `Compared with ${shortName(other.name)} on your shortlist, this one ${run}${upfront}.${payback}`);
    });
    output.replaceChildren(
      el("p", { className: "decide-text" }, el("strong", {}, `About ${formatRupees(own.yearly)} a year`), ` to run at ${formatRupees(rate)} a unit.`),
      ...rows,
      el("p", { className: "meta" }, `${formatNumber(item.kwhYear)} kWh a year from the label × your rate. Real use depends on how you use it; prices are today's listing prices.`));
  };
  const rate = await loadTariff();
  if (rate) input.value = String(rate);
  input.addEventListener("input", () => {
    const value = validTariff(input.value);
    render(value);
    if (value) chrome.storage.local.set({ [TARIFF_KEY]: value }).catch(() => {});
  });
  render(rate);
  return el("div", { className: "decide-fact tariff" },
    el("label", { className: "tariff-field" }, el("span", { className: "eyebrow" }, "Your rate, ₹ per unit"), input),
    output);
}

// ---------- Stats and charts ----------

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

// "September 2031" -> years from today, or null.
function yearsUntil(monthLabel) {
  const match = /^(\w+) (\d{4})$/.exec(monthLabel || "");
  const month = match ? MONTH_NAMES.indexOf(match[1]) : -1;
  if (month < 0) return null;
  const years = (new Date(Number(match[2]), month, 1) - Date.now()) / (365.25 * 24 * 3600 * 1000);
  return years > 0 ? years : null;
}

function ordinal(number) {
  const suffix = { 1: "st", 2: "nd", 3: "rd" }[number % 100 > 10 && number % 100 < 14 ? 0 : number % 10] || "th";
  return `${number}${suffix}`;
}

// tiles: [{ value, unit, label, source }]
function statTiles(tiles) {
  const shown = tiles.filter(Boolean);
  if (shown.length === 0) return null;
  return el("div", { className: "stats" }, shown.map((tile) => el("div", { className: "stat" },
    el("p", { className: "stat-figure" }, el("span", { className: "stat-number" }, tile.value), tile.unit ? el("span", { className: "stat-unit" }, tile.unit) : null),
    el("p", { className: "stat-label" }, tile.label),
    tile.source ? sourceLink(tile.source, "Factor") : null,
  )));
}

// rows: [{ label, value, display, mark: "current" | "suggested" | null, tag }]
function barChart(title, rows, note) {
  const max = Math.max(...rows.map((row) => row.value));
  return el("figure", { className: "chart" },
    el("figcaption", { className: "chart-title" }, title),
    el("div", { className: "bars", role: "list" }, rows.map((row, index) => el("div", {
      className: `bar-row${row.mark ? ` ${row.mark}` : ""}`, role: "listitem",
      "aria-label": `${row.label}: ${row.display}${row.tag ? `, ${row.tag}` : ""}`,
    },
    el("span", { className: "bar-name" }, row.label, row.tag ? el("span", { className: "bar-tag" }, row.tag) : null),
    el("span", { className: "bar-track" }, el("span", { className: "bar-fill", style: `width: ${Math.max(3, (row.value / max) * 100)}%; animation-delay: ${index * 40}ms` })),
    el("span", { className: "bar-value" }, row.display)))),
    note ? el("p", { className: "chart-note" }, note) : null);
}

function yearChart(title, years, note) {
  const max = Math.max(...years.map((item) => item.count));
  return el("figure", { className: "chart" },
    el("figcaption", { className: "chart-title" }, title),
    el("div", { className: "columns", role: "list" }, years.map((item, index) => el("div", {
      className: `column${item.current ? " current" : ""}`, role: "listitem",
      "aria-label": `${item.year}: ${item.count}${item.current ? ", this one" : ""}`,
    },
    el("span", { className: "column-count" }, item.count),
    el("span", { className: "column-bar", style: `height: ${Math.max(6, (item.count / max) * 100)}%; animation-delay: ${index * 50}ms` }),
    el("span", { className: "column-year" }, String(item.year).slice(2))))),
    note ? el("p", { className: "chart-note" }, note) : null);
}

// Simple line icons for the everyday comparisons. Fixed shapes only, never page data.
const EVERYDAY_ICONS = {
  "petrol-car-km": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 15l1.6-5a2 2 0 0 1 1.9-1.4h9a2 2 0 0 1 1.9 1.4L20 15v3h-2.2M4 15v3h2.2M4 15h16M9.8 18h4.4"/><circle cx="7.6" cy="18" r="1.6"/><circle cx="16.4" cy="18" r="1.6"/></svg>',
  "scooter-km": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="17" r="2.4"/><circle cx="18" cy="17" r="2.4"/><path d="M8.4 17h7.2M15 17l-2-8h-2.5M13 9h3l2 8M6 14.6V12h5"/></svg>',
  "phone-charge": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M12.6 8l-2 4h3l-2 4"/></svg>',
  "india-grid-kwh": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0V8zM12 16v5"/></svg>',
  "tree-year": '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c-3.3 0-6 2.5-6 5.6 0 .9.2 1.7.6 2.4A4 4 0 0 0 8 18h8a4 4 0 0 0 1.4-7c.4-.7.6-1.5.6-2.4C18 5.5 15.3 3 12 3zM12 12v9M9.5 15.5 12 18l2.5-2.5"/></svg>',
};

function everydayIcon(factorId) {
  const icon = el("span", { className: "everyday-icon" });
  icon.innerHTML = EVERYDAY_ICONS[factorId] || EVERYDAY_ICONS["india-grid-kwh"];
  return icon;
}

// A footprint in things people do every day: driving, riding a scooter, charging a phone, using electricity.
function everydayTerms(equivalents, intro) {
  if (!equivalents?.length) return null;
  return el("div", { className: "everyday" },
    el("p", { className: "everyday-intro" }, intro),
    el("ul", { className: "everyday-list" }, equivalents.map((item) => el("li", { className: "everyday-item" },
      everydayIcon(item.factorId),
      el("span", { className: "everyday-amount" }, formatNumber(item.amount)),
      el("span", { className: "everyday-unit" }, item.unit),
      sourceLink(item.source, "Source"),
    ))),
  );
}

function shortModel(name, brand) {
  return name.startsWith(`${brand} `) ? name.slice(brand.length + 1) : name;
}

// What a device's facts mean: headline stats, then where it sits among comparable devices.
function deviceMeaning(card, category) {
  const word = DEVICE_WORDS[category];
  const support = card?.scorecard?.support;
  const footprint = card?.scorecard?.footprint;
  const yearsLeft = yearsUntil(support?.value);
  const tiles = statTiles([
    yearsLeft ? { value: yearsLeft.toFixed(1), unit: "yrs", label: `of security updates left, until at least ${support.value}` } : null,
    card?.carbon ? { value: formatNumber(card.carbon.kg), unit: "kg CO₂e", label: `lifecycle footprint ${card.product.brand} reports` } : null,
    footprint?.rank ? { value: ordinal(footprint.rank), unit: `of ${footprint.count}`, label: `lowest footprint among ${footprint.brand} ${word}s` } : null,
  ]);
  const everyday = card?.carbon
    ? everydayTerms(card.carbon.equivalents, `Its ${formatNumber(card.carbon.kg)} kg CO₂e is about the same as any one of these:`)
    : null;

  const charts = [];
  if (footprint?.devices?.length >= 3) {
    const suggested = card.lowerFootprint?.modelId;
    charts.push(barChart(`${footprint.brand} ${word}s: lifecycle footprint the maker reports`,
      footprint.devices.map((device) => ({
        label: shortModel(device.name, footprint.brand),
        value: device.kg,
        display: `${formatNumber(device.kg)} kg`,
        mark: device.current ? "current" : device.modelId === suggested ? "suggested" : null,
        tag: device.current ? "this one" : device.modelId === suggested ? "suggested" : null,
      })),
      `Only ${footprint.brand}'s own reports are compared, because makers measure differently. Each figure is for the configuration its report names.`));
  }
  if (support?.years?.length >= 2) {
    charts.push(yearChart(`How long ${word}s in EcoCart's list get security updates`, support.years,
      `${support.count} ${word}s by the year their promised updates end. Highlighted: this one, until at least ${support.value}.`));
  }
  return [tiles, everyday, ...charts];
}

// What a category estimate means: everyday terms, and the category beside everyday ones per rupee spent.
function estimateCharts(estimate) {
  const rank = estimate.perRupee;
  const tiles = statTiles([
    { value: formatNumber(estimate.kgPerThousandInr), unit: "kg CO₂e", label: "per ₹1,000 spent, the category average" },
    rank.rank ? { value: ordinal(rank.rank), unit: `of ${rank.count}`, label: "product types, lowest per rupee first" } : null,
  ]);
  const everyday = everydayTerms(estimate.equivalents, `About ${formatNumber(estimate.kg)} kg CO₂e is roughly the same as any one of these:`);
  const chart = rank.examples?.length >= 3
    ? barChart("Per ₹1,000 spent, beside everyday categories", rank.examples.map((item) => ({
      label: item.label,
      value: item.kgPerThousandInr,
      display: `${formatNumber(item.kgPerThousandInr)} kg`,
      mark: item.current ? "current" : null,
      tag: item.current ? "this one" : null,
    })), "Open CEDA averages for India. They describe each category, not any one product.")
    : null;
  return [everyday, tiles, chart];
}

// ---------- Scorecard ----------

// row: { label, value, position (0 to 1, or null), ends: [left, right], note, unknown }
function scoreRow(row) {
  const bar = row.position == null ? null : el("div", { className: "score-bar", role: "img",
    "aria-label": `${row.label}: ${row.value}, between ${row.ends[0]} and ${row.ends[1]}` },
    el("span", { className: "score-track" }, el("span", { className: "score-mark", style: `left: ${row.position * 100}%` })),
    el("span", { className: "score-ends" }, el("span", {}, row.ends[0]), el("span", {}, row.ends[1])),
  );
  return el("div", { className: "score-row" },
    el("p", { className: "score-label" }, row.label),
    el("div", { className: "score-body" },
      el("p", { className: row.unknown ? "score-value unknown" : "score-value" }, row.value),
      bar,
      row.note ? el("p", { className: "score-note" }, row.note) : null,
    ),
  );
}

function renderScorecard(rows) {
  return el("div", { className: "scorecard" },
    el("p", { className: "eyebrow" }, "Before you buy"),
    rows.filter(Boolean).map(scoreRow),
    el("p", { className: "note" }, "Each line is a separate fact. EcoCart does not add them up into a verdict."),
  );
}

function energyRow(page) {
  const stars = energyStars(page);
  if (!stars) return null;
  return { label: "Energy rating", value: `${"★".repeat(stars)}${"☆".repeat(5 - stars)}  ${stars} of 5 stars (BEE)`,
    position: (stars - 1) / 4, ends: ["1 star", "5 stars"], note: "As stated on this listing. More stars use less electricity." };
}

function labelsRow(page) {
  const names = listingCertifications(page).map(([name]) => name);
  if (page.shopBadge) names.unshift(`${SITE.name} badge`);
  return names.length ? { label: "Labels", value: names.join(", "), note: "Stated on the listing, not checked by EcoCart." } : null;
}

async function planRow(planKey, word) {
  const planned = await hasPlan(planKey);
  return { label: `Old ${word}`, value: planned ? "Plan saved" : "No plan yet", unknown: !planned,
    note: planned ? "Mark it done from the EcoCart icon when it is handed over." : "See below for where it can go." };
}

function supportRow(card, word) {
  const support = card?.scorecard?.support;
  if (!support) {
    const wording = card?.headline?.source ? card.headline.value : null;
    if (wording) return { label: "Security updates", value: wording, note: sourceLink(card.headline.source, "Official policy") };
    return { label: "Security updates", value: "No official date found", unknown: true,
      note: `We show a date only when the maker publishes one for this ${word}.` };
  }
  const { headline } = card;
  return {
    label: "Security updates", value: `Until at least ${support.value}`, position: support.position, ends: [support.low, support.high],
    note: [
      support.position == null ? null : `Compared with ${support.count} ${word}s in our list. `,
      headline.derived ? "Worked out from " : null,
      sourceLink(headline.source, headline.derived ? "the policy" : "Official policy"),
      headline.derived && headline.startSource ? [" and ", sourceLink(headline.startSource, "start date")] : null,
    ],
  };
}

function footprintRow(card, word) {
  const footprint = card?.scorecard?.footprint;
  // Without a card there is nothing to say about the footprint, so the row is left out.
  if (!footprint) return card ? { label: "Reported footprint", value: `Not published by ${card.product.brand}`, unknown: true } : null;
  const { carbon } = card;
  const compared = footprint.position == null
    ? `Reported by ${footprint.brand}`
    : `Compared with ${footprint.count} ${footprint.brand} ${word}s; makers measure differently, so only the same maker is compared`;
  return {
    label: "Reported footprint", value: `${formatNumber(footprint.value)} kg CO₂e`, position: footprint.position,
    ends: [`${footprint.low} kg`, `${footprint.high} kg`],
    note: [compared, carbon.basis ? `${DOT}${carbon.basis}` : null, DOT, sourceLink(carbon.source)],
  };
}

async function deviceScorecard(card, page, category, planKey) {
  const word = DEVICE_WORDS[category];
  const rows = [
    // Fridges and washing machines get no security updates to speak of.
    category === "appliance" ? null : supportRow(card, word),
    footprintRow(card, word),
    energyRow(page),
    labelsRow(page),
    await planRow(planKey, word),
  ];
  return renderScorecard(rows);
}

function estimateScorecard(estimate, page) {
  const rows = [energyRow(page), labelsRow(page)].filter(Boolean);
  return rows.length ? renderScorecard(rows) : null;
}

// ---------- Better options ----------

function optionRow(kind, title, ...body) {
  return el("div", { className: "option-row" },
    el("p", { className: "eyebrow accent" }, kind),
    el("p", { className: "option-title" }, title),
    ...body,
  );
}

function catalogAlternativeRows(card, item) {
  const rows = [];
  const alt = card?.alternative;
  if (alt) {
    rows.push(optionRow("Similar price, longer support", alt.displayName,
      el("p", {}, alt.reason),
      el("p", { className: "meta" }, `${formatRupees(alt.price.value)} as of ${formatDate(alt.price.checked)}${DOT}`,
        sourceLink(alt.price.source, "Price"), DOT, sourceLink(alt.supportSource, "Policy"), DOT,
        shopSearchLink(alt.displayName, `Find on ${SITE.name}`)),
      el("p", { className: "note" }, "Longer software support does not by itself mean lower emissions."),
    ));
  }
  const lower = card?.lowerFootprint;
  if (lower) {
    const { lowerItem, difference } = lowerFootprintChoice(card, lower);
    rows.push(optionRow("Same maker, similar price, lower footprint", lower.displayName,
      el("p", {}, lower.reason),
      el("p", { className: "meta" }, `${formatRupees(lower.price.value)} as of ${formatDate(lower.price.checked)}${DOT}`,
        sourceLink(lower.price.source, "Price"), DOT, sourceLink(lower.carbonSource, "Report"), DOT,
        shopSearchLink(lower.displayName, `Find on ${SITE.name}`)),
      item ? choiceControls(lowerItem, item, difference) : null,
    ));
  }
  return rows;
}

// The suggested lower-footprint device as a shortlist item, and how much lower its reported footprint is.
function lowerFootprintChoice(card, lower) {
  const lowerItem = {
    key: `model:${lower.modelId}`, kind: "device", category: card.product.category, brand: card.product.brand,
    modelId: lower.modelId, name: lower.displayName, price: lower.price.value, shop: SITE.name, url: SITE.searchUrl(lower.displayName),
    carbonKg: lower.kg, carbonBasis: lower.basis || null, carbonSource: lower.carbonSource,
  };
  const difference = `${formatNumber(Math.round((card.carbon.kg - lower.kg) * 10) / 10)} kg CO₂e`;
  return { lowerItem, difference };
}

// A renewed listing of the same model on the shop, found by reading the shop's own search results.
async function findRenewed(name, catalogEntry) {
  if (!SITE.readSearchPage) return null;
  let results;
  try {
    results = await SITE.readSearchPage(`${name} renewed`);
  } catch {
    return null;
  }
  const words = normalizeTitle(name).split(" ").filter((word) => word.length > 1);
  return results.find(({ title, price }) => {
    if (!price || !/\b(renewed|refurbished)\b/i.test(title)) return false;
    if (catalogEntry) return matchByAlias(title, [catalogEntry]) !== null;
    const normalized = ` ${normalizeTitle(title)} `;
    return words.every((word) => normalized.includes(` ${word} `));
  }) || null;
}

async function refurbishedRow(name, catalogEntry, word) {
  const found = await findRenewed(name, catalogEntry);
  if (found) {
    return optionRow("Buy it renewed", found.title,
      el("p", {}, `${formatRupees(found.price)} on ${SITE.name} right now. A renewed ${word} avoids the footprint of making a new one.`),
      el("p", { className: "meta" }, el("a", { href: found.url, target: "_blank", rel: "noopener noreferrer" }, `Open the listing ${ARROW}`), DOT,
        "Check the condition, warranty and seller before buying."),
    );
  }
  return optionRow("Buy it renewed", `Look for a renewed ${name}`,
    el("p", {}, `A renewed or refurbished ${word} avoids the footprint of making a new one.`),
    el("p", { className: "meta" }, shopSearchLink(`${name} ${SITE.name === "Flipkart" ? "refurbished" : "renewed"}`, `Search ${SITE.name}`)),
  );
}

// Below this a "yearly" figure is really per cycle or per hour, which listings sometimes put in the yearly field.
const MIN_YEARLY_KWH = 5;

function annualKwh(details) {
  for (const [label, value] of Object.entries(details)) {
    if (!KWH_LABEL.test(label) || /cycle|\/\s*kg|per kg|per hour/i.test(value)) continue;
    const match = /([\d.,]+)\s*(?:kwh|units|kilowatt[\s-]*hours?)/i.exec(value);
    const yearly = /year|annual|annum/i.test(`${label} ${value}`);
    const kwh = match ? Number.parseFloat(match[1].replace(/,/g, "")) : null;
    if (yearly && kwh >= MIN_YEARLY_KWH) return kwh;
  }
  return null;
}

async function energyOptionRow(page, typeName) {
  const stars = energyStars(page);
  const kwh = annualKwh(page.details);
  if (!stars && !kwh) return null;
  const body = [];
  if (kwh) {
    const grid = (await loadFactors()).find((factor) => factor.factorId === "india-grid-kwh");
    body.push(el("p", {}, `Its label says it uses ${formatNumber(kwh)} kWh a year`,
      grid ? `, about ${formatNumber(Math.round(kwh * grid.kgCo2ePerUnit))} kg CO₂e a year from India's grid. ` : ". ",
      grid ? sourceLink(grid.source, "Grid factor") : null));
  }
  if (stars && stars < 5) {
    body.push(el("p", {}, "A 5 star model of the same size uses less electricity every year it runs. ",
      shopSearchLink(`5 star ${typeName}`, "See 5 star models")));
  }
  if (body.length === 0) return null;
  return optionRow("Running it", stars === 5 ? "Already the top BEE rating" : "Electricity over its life", ...body);
}

function refillRow(estimate, page) {
  if (!REFILL_SECTORS.has(estimate.sector.code)) return null;
  const brand = clean(page.details.Brand || "");
  const query = `${brand && !shortName(page.title).toLowerCase().startsWith(brand.toLowerCase()) ? `${brand} ` : ""}${shortName(page.title)} refill`;
  return optionRow("Less packaging", "Look for a refill or bigger pack",
    el("p", {}, "Refill packs and larger sizes usually use less packaging for the same amount."),
    el("p", { className: "meta" }, shopSearchLink(query, `Search ${SITE.name}`)),
  );
}

const TIPS = {
  device: [
    "Using a device for longer is the biggest saving: most of its footprint comes from making it.",
    "A repair or a new battery usually costs far less than a new device.",
  ],
  appliance: [
    "Using an appliance for longer is the biggest saving: making a new one has a large footprint.",
    "A repair is usually far cheaper than a replacement. Ask the brand's service centre first.",
  ],
  clothing: ["Wear it often and keep it longer.", "Wash cooler and line dry to save electricity.", "Second-hand clothes avoid a new garment being made."],
  food: ["Buy what you will use. Food that goes to waste wastes everything that went into making it."],
  general: ["Buying fewer things that last longer cuts your footprint more than any single swap."],
};

function tipsRow(kind) {
  return el("div", { className: "option-row tips" },
    el("p", { className: "eyebrow" }, "General tips, not specific to this product"),
    el("ul", {}, TIPS[kind].map((tip) => el("li", {}, tip))),
  );
}

function tipKind(estimate) {
  if (!estimate) return "device";
  if (estimate.sector.code === "315000") return "clothing";
  if (/^311|^312|^1111/.test(estimate.sector.code)) return "food";
  return "general";
}

// Rows that need a network call are added when they arrive, so the card never waits for them.
function renderBetterOptions(immediateRows, pendingRows, kind) {
  const list = el("div", { className: "options-list" }, immediateRows.filter(Boolean));
  const section = el("div", { className: "options" },
    el("p", { className: "section-title" }, "Better options"), list, tipsRow(kind));
  for (const pending of pendingRows) {
    pending.then((row) => row && list.append(row)).catch(() => {});
  }
  return section;
}

function deviceOptions(card, page, category, item = null, { catalogRows = true } = {}) {
  const word = DEVICE_WORDS[category];
  const name = card ? card.product.displayName.replace(/^(Apple|Samsung|Google|OnePlus) /, "") : shortName(page.title);
  const typeName = page.crumbs[page.crumbs.length - 1] || word;
  const catalogEntry = card
    ? loadFullCatalog().then((catalog) => catalog.find((item) => item.modelId === card.product.modelId) || null)
    : Promise.resolve(null);
  const pending = [catalogEntry.then((entry) => refurbishedRow(name, entry, word))];
  if (category === "tv" || category === "appliance") pending.push(energyOptionRow(page, typeName));
  return renderBetterOptions(catalogRows ? catalogAlternativeRows(card, item) : [], pending, category === "appliance" ? "appliance" : "device");
}

function estimateOptions(estimate, page) {
  const typeName = page.crumbs[page.crumbs.length - 1] || estimate.category;
  return renderBetterOptions([refillRow(estimate, page)], [energyOptionRow(page, typeName)], tipKind(estimate));
}
