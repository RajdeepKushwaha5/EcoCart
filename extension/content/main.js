// Decides what to do on the current shop page, and re-checks when the URL changes.
// Both shops can switch product variants without a full page load.

// Full page reads before a product page that shows no product (a removed listing, a robot check) is left alone.
// A cheap check of the title and price keeps running, so a product that appears later still gets its card.
const GIVE_UP_ATTEMPTS = 10;
// Full re-reads after the card is shown while the price or category is still missing.
const INCOMPLETE_CHECKS = 30;
// Full re-reads after a complete page, because shops load the description and details a moment later.
const SETTLING_CHECKS = 8;

let currentPageKey = null;
let currentProductSignature = null;
let currentQuickState = null;
let productAttempts = 0;
let incompleteChecks = 0;

function pageSignature(page) {
  return page ? JSON.stringify([page.title, page.price, page.crumbs, page.details, page.bullets, page.description]) : null;
}

// One key per product and variant. Both shops put the variant in the listing ID, so tracking parameters are ignored.
function pageKey() {
  const listingId = SITE.listingId();
  return listingId ? `product:${listingId}` : location.pathname;
}

function isIncomplete(page) {
  return page.price === null || page.crumbs.length === 0;
}

// Same product page as last time: keep the card in place and redraw it only when what it is based on has changed.
function refreshProductPage() {
  keepCardAttached();
  const quickState = SITE.quickProductState();
  if (incompleteChecks === 0 && quickState === currentQuickState) return;
  if (incompleteChecks > 0) incompleteChecks -= 1;
  const page = SITE.readProductPage();
  if (!page) return;
  currentQuickState = quickState;
  const signature = pageSignature(page);
  if (signature !== currentProductSignature) {
    currentProductSignature = signature;
    runProductPage(READY_ATTEMPTS, page);
  }
  if (!isIncomplete(page)) incompleteChecks = Math.min(incompleteChecks, SETTLING_CHECKS);
}

function leaveProductPage() {
  productRunId += 1;
  document.getElementById(CARD_ID)?.remove();
  cardHost = null;
  currentProductSignature = null;
  currentQuickState = null;
  incompleteChecks = 0;
}

function settleProductPage(key, page) {
  currentPageKey = key;
  currentProductSignature = pageSignature(page);
  currentQuickState = SITE.quickProductState();
  incompleteChecks = page && isIncomplete(page) ? INCOMPLETE_CHECKS : page ? SETTLING_CHECKS : 0;
  productAttempts = 0;
}

function routePage() {
  const key = pageKey();
  if (key === currentPageKey) {
    if (key.startsWith("product:")) refreshProductPage();
    return;
  }

  if (key.startsWith("product:")) {
    if (currentPageKey && currentPageKey !== key) leaveProductPage();
    const page = SITE.readProductPage();
    // A page that is still being built is checked again on the next tick.
    if (page && runProductPage(productAttempts, page)) {
      settleProductPage(key, page);
      return;
    }
    productAttempts += 1;
    if (!page && productAttempts >= GIVE_UP_ATTEMPTS) settleProductPage(key, null);
    else currentPageKey = null;
    return;
  }

  currentPageKey = key;
  productAttempts = 0;
  leaveProductPage();
  if (SITE.isSearchPage()) startSearchBadges();
  if (SITE.isThankYouPage()) showThankYouReminder();
}

routePage();
setInterval(routePage, 1000);
