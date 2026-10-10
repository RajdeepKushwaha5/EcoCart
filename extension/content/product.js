// Product page: the device passport card and the old-device plan. SITE (sites.js) reads the shop page.

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

const CONFIRMED_KEY = "confirmedMatches";
const CARD_ID = "ecocart-card";

let productRunId = 0;
// The card's host element. Shops that rebuild their page can remove it; keepCardAttached puts it back.
let cardHost = null;

// A card placed before the shop drew its title is marked provisional and moved next to the title once it appears.
function keepCardAttached() {
  if (cardHost && (!cardHost.isConnected || cardHost.dataset.provisional)) SITE.placeCard(cardHost);
}

// A variant or price changed: show the existing card as loading at once, so it never shows the previous product's facts.
function markCardLoading() {
  const body = cardHost?.shadowRoot?.querySelector(".body");
  if (body) renderLoading(body);
}

// ---------- Card frame and simple states ----------

function mountCard(tagText) {
  let placed = false;
  const shadow = mountShadow(CARD_ID, (host) => {
    placed = SITE.placeCard(host);
  }, "styles/card.css");
  if (!placed) {
    document.getElementById(CARD_ID)?.remove();
    cardHost = null;
    return null;
  }
  cardHost = shadow.host;

  const body = el("div", { className: "body" });
  const toggle = el("button", {
    className: "toggle",
    type: "button",
    "aria-expanded": "true",
    onClick: () => {
      const hidden = body.toggleAttribute("hidden");
      toggle.textContent = hidden ? "Show" : "Hide";
      toggle.setAttribute("aria-expanded", String(!hidden));
    },
  }, "Hide");

  shadow.append(el("section", { className: "card", "aria-label": "EcoCart" },
    logoBar(tagText, toggle), body));
  return body;
}

// The card reads in three steps: the evidence, what it means, and what the shopper can do about it.
function cardStep(number, title, ...children) {
  const content = children.flat().filter(Boolean);
  if (content.length === 0) return null;
  return el("section", { className: "step" },
    el("header", { className: "step-head" }, el("span", { className: "step-num" }, number), el("h3", { className: "step-title" }, title)),
    el("div", { className: "step-body" }, content));
}

function passportTag(category) {
  return `${capitalize(DEVICE_WORDS[category])} passport`;
}

function renderLoading(body) {
  show(body, el("div", { className: "loading", "aria-label": "Loading" },
    el("span", { className: "shimmer wide" }), el("span", { className: "shimmer" }), el("span", { className: "shimmer short" })));
}

function renderMessage(body, title, text, action) {
  show(body, el("div", { className: "message" }, el("p", { className: "message-title" }, title),
    text ? el("p", { className: "muted" }, text) : null, action));
}

function renderError(body, retry) {
  renderMessage(body, "EcoCart couldn't reach its server.",
    "Nothing is shown rather than a guess. Check your connection and try again.", button("Retry", () => retry()));
}

// Devices outside the catalog still get the part that helps most: a plan for the old one.
async function renderUnsupported(body, page, category) {
  const word = DEVICE_WORDS[category];
  const planKey = `listing:${SITE.listingId()}`;
  const scorecard = await deviceScorecard(null, page, category, planKey);
  const item = shortlistItem(page, null, category);
  logActivity("checked", item);
  show(body,
    cardStep("01", "What we know",
      el("div", { className: "message" },
        el("p", { className: "message-title" }, `No official figures for this ${word} yet.`),
        el("p", { className: "muted" }, `We only show what the maker has published. You can still check your options and plan for your old ${word}.`),
      ),
      renderLabels(page)),
    cardStep("02", "What this means", scorecard),
    cardStep("03", "What you can do",
      shortlistControl(item),
      deviceOptions(null, page, category, item),
      renderOldDevice({ modelId: null, listingName: page.title, category, planKey }, { showsExchange: page.showsExchange })),
  );
}

function renderConfirm(body, candidates, category, onConfirm, onReject) {
  show(body, el("div", { className: "message" },
    el("p", { className: "message-title" }, `Which ${DEVICE_WORDS[category]} is this listing for?`),
    el("div", { className: "row" },
      candidates.map((candidate) => button(candidate.displayName, () => onConfirm(candidate.modelId), "ghost")),
      el("button", { className: "text-btn", type: "button", onClick: onReject }, "None of these"),
    ),
  ));
}

// ---------- Card content ----------

function policyText(fact) {
  if (fact.value) return fact.value;
  return fact.supportEndDate ? `Support until ${formatDate(fact.supportEndDate)}` : null;
}

function repairText(fact) {
  if (fact.value == null) return null;
  return fact.scale ? `${fact.value} (${fact.scale})` : String(fact.value);
}

function takeBackText(fact) {
  if (fact.value === true) return "Available";
  if (fact.value === false) return "Not offered";
  return null;
}

function specRow(label, fact, format) {
  const value = fact ? format(fact) : null;
  return el("div", { className: "spec" },
    el("dt", {}, label),
    el("dd", {},
      value ? el("span", { className: "value" }, value) : el("span", { className: "chip" }, "Unknown"),
      value && fact.source
        ? el("span", { className: "meta" }, sourceLink(fact.source), `${DOT}checked ${formatDate(fact.checked)}`)
        : null,
    ),
  );
}

function renderSpecs(product) {
  return el("dl", { className: "specs" },
    specRow("Update policy", product.updatePolicy, policyText),
    specRow("Repair info", product.repairability, repairText),
    specRow("Brand take-back", product.takeBack, takeBackText),
  );
}

// What the reported footprint covers, so the comparisons above are not read as a saving.
function footprintScope(card, word) {
  if (!card.carbon) return null;
  return el("p", { className: "note" }, `The footprint covers making, shipping, using and recycling this ${word}. It is not a saving you get by choosing it.`);
}

// The plain-language opening line, readable in a couple of seconds.
function renderLede(card) {
  return el("div", { className: "lede" },
    el("p", {}, card.explanation),
    el("p", { className: "lede-source" },
      card.explanationSource === "bedrock" ? "Written by Amazon Bedrock from the sourced facts below" : "From the sourced facts below"),
  );
}

function renderDetails(card) {
  return el("details", { className: "details" },
    el("summary", {}, "More details"),
    el("div", { className: "details-body" },
      renderSpecs(card.product),
      card.alternative ? null : el("p", { className: "note" }, card.alternativeReason),
    ),
  );
}

async function renderCard(body, card, page) {
  const category = card.product.category;
  const planKey = `model:${card.product.modelId}`;
  const scorecard = await deviceScorecard(card, page, category, planKey);
  const item = shortlistItem(page, card, category);
  logActivity("checked", item);
  show(body,
    cardStep("01", "What we know", renderLede(card), renderLabels(page), renderDetails(card)),
    cardStep("02", "What this means", deviceMeaning(card, category), scorecard, footprintScope(card, DEVICE_WORDS[category])),
    cardStep("03", "What you can do",
      shortlistControl(item),
      deviceOptions(card, page, category, item),
      renderOldDevice({ modelId: card.product.modelId, category, planKey }, { showsExchange: page.showsExchange })),
  );
}

// ---------- Old-device plan (also used by the order-page reminder) ----------

const CITY_KEY = "lastCity";

function select(name, label, options, selected) {
  return el("label", { className: "field" },
    el("span", { className: "eyebrow" }, label),
    el("select", { name }, options.map(([value, text]) => el("option", { value, selected: value === selected }, text))));
}

function optionTile(option, index) {
  return el("label", { className: "tile" },
    el("input", { type: "radio", name: "optionId", value: option.optionId }),
    el("span", { className: "num" }, String(index + 1).padStart(2, "0")),
    el("span", { className: "tile-body" },
      el("span", { className: "tile-head" }, el("strong", {}, option.name), el("span", { className: "type" }, option.type)),
      option.accepts ? el("span", {}, `Takes: ${option.accepts}`) : null,
      el("span", {}, option.handover),
      option.address ? el("span", { className: "muted" }, option.address) : null,
      el("span", { className: "meta" },
        option.url ? sourceLink(option.url, "Website") : null, option.url ? DOT : null,
        sourceLink(option.source), `${DOT}checked ${formatDate(option.checked)}`),
      el("span", { className: option.handoffConfirmed ? "flag ok" : "flag" },
        option.handoffConfirmed ? "Handoff confirmed by our team" : "Handoff not yet confirmed by our team"),
    ),
  );
}

// device: { modelId } for a catalog device, or { modelId: null, listingName } for any other listing.
function renderOldDevice(device, { showsExchange = false, intro } = {}) {
  const category = device.category || "phone";
  const word = DEVICE_WORDS[category];
  const section = el("div", { className: "old-phone" });
  const heading = (text) => el("p", { className: "section-title" }, text);

  const ask = () => show(section,
    heading(`What happens to your old ${word}?`),
    el("p", { className: "muted" }, intro || `Make a plan now, while you are choosing the new one.`),
    el("div", { className: "row" },
      button("Plan it", showForm),
      button("Not now", () => show(section, el("p", { className: "note" }, "No problem. The option stays here."),
        el("button", { className: "text-btn", type: "button", onClick: ask }, "Plan it after all")), "ghost"),
    ),
  );

  async function showForm() {
    const { data } = await chrome.runtime.sendMessage({ type: "config" });
    const { [CITY_KEY]: lastCity } = await chrome.storage.local.get(CITY_KEY);
    const form = el("form", { className: "form" },
      el("div", { className: "fields" },
        select("brand", "Brand", OLD_DEVICE_BRANDS[category].map((b) => [b, b])),
        select("ageYears", "Age", Array.from({ length: 11 }, (_, i) => [i, i === 10 ? "10+ years" : `${i} years`])),
        select("city", "City", data.cities.map((c) => [c.id, c.name]), lastCity),
      ),
      button("Show options", null, "primary", "submit"),
    );
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      chrome.storage.local.set({ [CITY_KEY]: values.city });
      showOptions({ brand: values.brand, ageYears: Number(values.ageYears), city: values.city });
    });
    show(section, heading(`Tell us about your old ${word}`), form);
  }

  async function showOptions(oldDevice) {
    show(section, el("div", { className: "loading" }, el("span", { className: "shimmer wide" })));
    let options;
    try {
      const query = new URLSearchParams({ city: oldDevice.city, brand: oldDevice.brand, category });
      ({ options } = await api("GET", `/options?${query}`));
    } catch {
      show(section, el("p", {}, "Couldn't load options."), button("Retry", () => showOptions(oldDevice)));
      return;
    }

    const exchangeNote = showsExchange
      ? el("p", { className: "callout" }, `This listing shows a ${SITE.name} exchange offer. Check the buy box for the terms.`)
      : null;
    if (options.length === 0) {
      show(section, heading(`No options for your old ${word} here yet`), exchangeNote,
        el("p", { className: "muted" }, "We only list places we have checked. More are coming."));
      return;
    }

    const status = el("p", { className: "note", role: "status" });
    const form = el("form", { className: "form" },
      el("div", { className: "tiles" }, options.map(optionTile)),
      button("Save my plan", null, "primary", "submit"),
      status,
    );
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const optionId = new FormData(form).get("optionId");
      if (!optionId) {
        status.textContent = "Pick one option first.";
        return;
      }
      status.textContent = "Saving...";
      const newDevice = device.modelId
        ? { modelIdBought: device.modelId }
        : { listingName: device.listingName.slice(0, 150), category };
      try {
        await api("POST", "/actions", {
          ...newDevice,
          oldDevice: { brand: oldDevice.brand, ageYears: oldDevice.ageYears },
          city: oldDevice.city,
          optionId,
        }, true);
        if (device.planKey) await rememberPlan(device.planKey);
        await logActivity("planned", { name: device.listingName || device.modelId, kind: "plan" });
        await chrome.storage.local.set({ [PLANS_CHANGED_KEY]: Date.now() });
        show(section, await savedMessage(word));
      } catch {
        status.textContent = "Couldn't save. Please try again.";
      }
    });
    show(section, heading(`Where your old ${word} can go`),
      el("p", { className: "note" }, "From each company's own page. Tap a source to check the details."),
      exchangeNote, form);
  }

  ask();
  return section;
}

// Shown after a plan is saved: the user's plant, and what makes it grow.
async function savedMessage(word) {
  let completed = 0;
  try {
    const { actions } = await api("GET", "/actions", undefined, true);
    completed = actions.filter((action) => action.status === "done").length;
  } catch {
    // The plan is saved either way; the plant just starts from the seed picture.
  }
  const { stage, name } = plantStage(completed);
  const art = el("div", { className: "saved-plant" });
  art.innerHTML = plantSvg(stage); // Fixed shapes only, no user data.
  return el("div", { className: "saved" },
    art,
    el("div", {},
      el("p", { className: "eyebrow accent" }, `Your plant: ${name}`),
      el("p", { className: "section-title" }, "Plan saved. Nice one."),
      el("p", { className: "muted" },
        `When the ${word} is handed over, mark it done from the EcoCart icon and your plant grows a stage.`),
      dashboardLink("See it in your dashboard"),
    ),
  );
}

// ---------- Category estimate (any other product) ----------

const ESTIMATE_TAG = "Footprint estimate";

function estimateMethod(estimate, page) {
  const source = page.crumbsFromDetails ? "the listing's category details" : "the shop's category";
  const sortedBy = {
    model: "Sorted into this category by Amazon Bedrock, from a fixed list.",
    title: `The page gives no category, so it was matched from "${estimate.matched}" in the product title.`,
  }[estimate.classifiedBy] || `Matched from ${source}: ${page.crumbs.join(" › ")}.`;
  const { dataset } = estimate;
  return el("details", { className: "details" },
    el("summary", {}, "How this is worked out"),
    el("div", { className: "details-body" },
      el("p", {}, `${formatRupees(estimate.priceInr)} (the price on this page) × about ${estimate.kgPerThousandInr} kg CO2e per ₹1,000, `
        + `the average for "${estimate.sector.name}" in India.`),
      el("p", { className: "muted" }, sortedBy),
      el("p", { className: "muted" },
        "Covers making the product and its materials, up to the factory gate. Using it and throwing it away are not included. "
        + `Based on ${dataset.baseYear} data, adjusted to ${dataset.priceYear} prices.`),
      el("p", { className: "meta" }, `${dataset.name}, ${dataset.attribution} (${dataset.licence})${DOT}`, sourceLink(dataset.source, "Dataset")),
    ),
  );
}

function renderEstimate(estimate, page) {
  return el("div", { className: "estimate" },
    el("p", { className: "estimate-flag" }, "Category estimate, not measured for this product"),
    el("p", { className: "stat-value" }, el("span", { className: "approx" }, "About "), formatNumber(estimate.kg),
      el("span", { className: "unit" }, " kg CO2e")),
    el("p", { className: "muted" }, `Typical for ${estimate.category.toLowerCase()} at this price in India.`),
    el("p", { className: "note" },
      "This is an average for the whole category, worked out from the price. A specific product can be well above or below it."),
    estimateMethod(estimate, page),
  );
}

// Why a product has no estimate, in the shopper's words. Digital items and gift cards get no card at all.
const NO_ESTIMATE = {
  "no-price": "The price on this page could not be read, so there is no estimate.",
  "no-offer": "This listing has no main price, only \"See All Buying Options\", so there is no estimate. Pick a seller's offer to see the price.",
  unclassified: "We have not matched this kind of product to a category yet, so there is no estimate.",
};

function renderNoEstimate(reason) {
  return el("div", { className: "message" },
    el("p", { className: "message-title" }, "No estimate for this product yet."),
    el("p", { className: "muted" }, NO_ESTIMATE[reason] || NO_ESTIMATE.unclassified),
  );
}

async function showEstimate(page) {
  const id = ++productRunId;
  markCardLoading();
  let result = null;
  try {
    result = await api("POST", "/estimate", { title: page.title, crumbs: page.crumbs, price: page.price });
  } catch {
    // Shown below as a retry.
  }
  if (id !== productRunId || result?.reason === "excluded") return;

  const body = mountCard(ESTIMATE_TAG);
  if (!body) return;
  if (!result) {
    renderError(body, () => showEstimate(page));
    return;
  }
  const estimate = result.estimate;
  const item = shortlistItem(page, null, null, estimate);
  logActivity("checked", item);
  if (estimate) {
    show(body,
      cardStep("01", "What we know", renderEstimate(estimate, page), renderLabels(page)),
      cardStep("02", "What this means", estimateCharts(estimate), estimateScorecard(estimate, page)),
      cardStep("03", "What you can do", shortlistControl(item), estimateOptions(estimate, page)));
    return;
  }
  const facts = [energyRow(page), labelsRow(page)].filter(Boolean);
  show(body,
    cardStep("01", "What we know",
      renderNoEstimate(result.reason === "no-price" && page.noFeaturedOffer ? "no-offer" : result.reason),
      renderLabels(page)),
    cardStep("02", "What this means", facts.length ? renderScorecard(facts) : null),
    cardStep("03", "What you can do",
      shortlistControl(item),
      renderBetterOptions([], [energyOptionRow(page, page.crumbs[page.crumbs.length - 1] || "product")], "general")),
  );
}

// ---------- Flow ----------

async function confirmedModel(listingId) {
  const stored = await chrome.storage.local.get(CONFIRMED_KEY);
  return stored[CONFIRMED_KEY]?.[listingId];
}

async function rememberModel(listingId, modelId) {
  const stored = await chrome.storage.local.get(CONFIRMED_KEY);
  await chrome.storage.local.set({ [CONFIRMED_KEY]: { ...stored[CONFIRMED_KEY], [listingId]: modelId } });
}

// How many one-second checks to wait for a page that is still being built.
const READY_ATTEMPTS = 8;

// Returns false when the page is not ready yet, so the caller can try again shortly.
function runProductPage(attempt = 0, readPage = null) {
  const listingId = SITE.listingId();
  const page = readPage || (listingId ? SITE.readProductPage() : null);
  const lastTry = attempt >= READY_ATTEMPTS - 1;
  if (!page) return false;
  if (SITE.rendersLate && page.crumbs.length === 0 && !lastTry) return false;
  // Devices get the passport. Everything else, accessories included, gets labels and a category estimate.
  const category = detectCategory(page.crumbs, page.title, page.crumbsFromDetails);
  if (category) showProduct(listingId, page, category);
  else showEstimate(page);
  return true;
}

async function showProduct(listingId, page, category) {
  const id = ++productRunId;
  const isStale = () => id !== productRunId;
  markCardLoading();

  let result;
  try {
    result = await api("POST", "/match", { title: page.title, details: page.details, category });
  } catch {
    if (isStale()) return;
    const body = mountCard(passportTag(category));
    if (body) renderError(body, () => showProduct(listingId, page, category));
    return;
  }
  if (isStale()) return;

  const body = mountCard(passportTag(category));
  if (!body) return;

  const loadCard = async (modelId) => {
    renderLoading(body);
    try {
      const query = page.price ? `?price=${page.price}` : "";
      const card = await api("GET", `/products/${encodeURIComponent(modelId)}${query}`);
      if (isStale()) return;
      renderCard(body, card, page);
      recordView(card);
    } catch {
      if (!isStale()) renderError(body, () => loadCard(modelId));
    }
  };

  if (result.modelId) {
    loadCard(result.modelId);
  } else if (result.matchType === "ambiguous") {
    const remembered = await confirmedModel(listingId);
    if (result.candidates.some((c) => c.modelId === remembered)) {
      loadCard(remembered);
    } else {
      renderConfirm(body, result.candidates, category,
        async (modelId) => { await rememberModel(listingId, modelId); loadCard(modelId); },
        () => renderUnsupported(body, page, category));
    }
  } else {
    renderUnsupported(body, page, category);
  }
}
