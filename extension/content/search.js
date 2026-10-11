// Search results: a small EcoCart badge on each result. Devices we have sourced data for show their support date,
// and every other result with a price shows the labelled category estimate for its kind of product at that price.
// Listings whose title names an eco label also say so, as the seller's claim. The catalog is matched here in the
// browser; for the estimates, each result's title and price are sent in one request per page and not stored.

const DONE_ATTR = "data-ecocart";

let catalogRequest = null;
let searchObserver = null;

function loadCatalog() {
  catalogRequest ??= api("GET", "/catalog")
    .then(({ products }) => products.filter((product) => product.badge))
    .catch(() => {
      catalogRequest = null;
      return [];
    });
  return catalogRequest;
}

// Where the matched device's name starts in the title.
function devicePosition(title, product) {
  const lowered = title.toLowerCase();
  const positions = product.aliases
    .map((alias) => lowered.indexOf(alias.split("+")[0].trim().toLowerCase()))
    .filter((index) => index >= 0);
  return positions.length > 0 ? Math.min(...positions) : -1;
}

function badge(text, title, kind = "") {
  registerFonts();
  const host = el("span", { className: "ecocart-badge-host" });
  const shadow = host.attachShadow({ mode: "open" });
  shadow.append(
    el("link", { rel: "stylesheet", href: chrome.runtime.getURL("styles/badge.css") }),
    el("span", { className: `badge ${kind}`, title },
      el("span", { className: "mark", "aria-hidden": "true" }), text),
  );
  return host;
}

function makeBadge(product) {
  return badge(product.badge, `EcoCart: sourced facts for ${product.displayName}`);
}

// A certification the result's own title names, such as GOTS or FSC. Worded as the seller's claim, which EcoCart has not checked.
function claimBadge(title) {
  const names = listingCertifications({ title, details: {}, bullets: [], description: "" }).map(([name]) => name);
  if (names.length === 0) return null;
  return badge(`Claims ${names.join(", ")}`, "The listing's title names this label. EcoCart has not checked it.", "claim");
}

const BATCH_SIZE = 60;

function estimateBadge(result) {
  return badge(`EcoCart estimate ≈ ${formatNumber(result.kg)} kg CO₂e`,
    `EcoCart category estimate: the average for ${result.category.toLowerCase()} at this price in India, not a measurement of this product. Open it for details.`,
    "estimate");
}

// One request per page for every result that is not a covered device.
async function estimateBadges(pending) {
  for (let start = 0; start < pending.length; start += BATCH_SIZE) {
    const batch = pending.slice(start, start + BATCH_SIZE);
    let results;
    try {
      ({ results } = await api("POST", "/estimates", { items: batch.map(({ title, price }) => ({ title, price })) }));
    } catch {
      return; // No badge rather than a wrong one.
    }
    batch.forEach(({ spot }, index) => {
      if (results[index]) spot.after(estimateBadge(results[index]));
    });
  }
}

async function badgeResults() {
  const results = SITE.searchResults().filter(({ node }) => !node.hasAttribute(DONE_ATTR));
  if (results.length === 0) return;
  // Marked before waiting, so a page change during the wait does not badge the same results twice.
  for (const { node } of results) node.setAttribute(DONE_ATTR, "");

  const catalog = await loadCatalog();
  const pending = [];
  for (const { node, title, anchor } of results) {
    if (!title || !anchor) continue;
    const product = matchByAlias(title, catalog);
    // "Case for Galaxy A56" names the device it fits, so it never gets the device's badge.
    if (product && !looksLikeAccessory(title, devicePosition(title, product))) {
      anchor.after(makeBadge(product));
      continue;
    }
    const claim = claimBadge(title);
    if (claim) anchor.after(claim);
    const price = SITE.resultPrice(node);
    if (price) pending.push({ title, price, spot: claim || anchor });
  }
  if (pending.length) await estimateBadges(pending);
}

function startSearchBadges() {
  badgeResults();
  if (searchObserver) return;
  let pending = null;
  searchObserver = new MutationObserver(() => {
    clearTimeout(pending);
    pending = setTimeout(badgeResults, 300);
  });
  searchObserver.observe(document.body, { childList: true, subtree: true });
}
