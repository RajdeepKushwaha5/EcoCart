// Search results: a small badge on devices we have sourced data for, and on listings whose title names an eco label.
// The catalog is fetched once and matched here, so result titles are never sent anywhere.

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

async function badgeResults() {
  const results = SITE.searchResults().filter(({ node }) => !node.hasAttribute(DONE_ATTR));
  if (results.length === 0) return;

  const catalog = await loadCatalog();
  for (const { node, title, anchor } of results) {
    node.setAttribute(DONE_ATTR, "");
    if (!title || !anchor) continue;
    const product = matchByAlias(title, catalog);
    // "Case for Galaxy A56" names the device it fits, so it never gets the device's badge.
    if (product && !looksLikeAccessory(title, devicePosition(title, product))) {
      anchor.after(makeBadge(product));
      continue;
    }
    const claim = claimBadge(title);
    if (claim) anchor.after(claim);
  }
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
