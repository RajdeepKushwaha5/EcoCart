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
function dashboardLink(label) {
  return el("button", { className: "text-btn", type: "button",
    onClick: () => chrome.runtime.sendMessage({ type: "openDashboard" }) }, `${label} ${ARROW}`);
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
    status.replaceChildren(stage === "chosen"
      ? `Recorded: you chose the ${chosen.name}. By ${chosen.brand}'s own reports, that is ${difference} less. `
      : "Both are on your shortlist. ", dashboardLink("Open dashboard"));
  };
  return el("div", { className: "choice" },
    el("div", { className: "row" },
      button("I'll choose this instead", record("chosen"), "primary"),
      button("Compare later", record("considered"), "ghost")),
    status);
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
    label: "Reported footprint", value: `${formatNumber(footprint.value)} kg CO2e`, position: footprint.position,
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
  const rank = estimate.perRupee;
  return renderScorecard([
    { label: "Per rupee spent", value: `About ${estimate.kgPerThousandInr} kg CO2e per ₹1,000`, position: rank.position,
      ends: [`${rank.lowest} kg`, `${rank.highest} kg`],
      note: `This category's place among the ${rank.count} product types EcoCart covers. It describes the category, not this product.` },
    energyRow(page),
    labelsRow(page),
  ]);
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
    const lowerItem = {
      key: `model:${lower.modelId}`, kind: "device", category: card.product.category, brand: card.product.brand,
      modelId: lower.modelId, name: lower.displayName, price: lower.price.value, shop: SITE.name, url: SITE.searchUrl(lower.displayName),
      carbonKg: lower.kg, carbonBasis: lower.basis || null, carbonSource: lower.carbonSource,
    };
    const difference = `${formatNumber(Math.round((card.carbon.kg - lower.kg) * 10) / 10)} kg CO2e`;
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

function annualKwh(details) {
  for (const [label, value] of Object.entries(details)) {
    if (!KWH_LABEL.test(label)) continue;
    const match = /([\d.,]+)\s*(?:kwh|units)/i.exec(value);
    const yearly = /year|annual|annum/i.test(`${label} ${value}`);
    if (match && yearly) return Number.parseFloat(match[1].replace(/,/g, ""));
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
      grid ? `, about ${formatNumber(Math.round(kwh * grid.kgCo2ePerUnit))} kg CO2e a year from India's grid. ` : ". ",
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

function deviceOptions(card, page, category, item = null) {
  const word = DEVICE_WORDS[category];
  const name = card ? card.product.displayName.replace(/^(Apple|Samsung|Google|OnePlus) /, "") : shortName(page.title);
  const typeName = page.crumbs[page.crumbs.length - 1] || word;
  const catalogEntry = card
    ? loadFullCatalog().then((catalog) => catalog.find((item) => item.modelId === card.product.modelId) || null)
    : Promise.resolve(null);
  const pending = [catalogEntry.then((entry) => refurbishedRow(name, entry, word))];
  if (category === "tv" || category === "appliance") pending.push(energyOptionRow(page, typeName));
  return renderBetterOptions(catalogAlternativeRows(card, item), pending, category === "appliance" ? "appliance" : "device");
}

function estimateOptions(estimate, page) {
  const typeName = page.crumbs[page.crumbs.length - 1] || estimate.category;
  return renderBetterOptions([refillRow(estimate, page)], [energyOptionRow(page, typeName)], tipKind(estimate));
}
