// Decides what to do on the current shop page, and re-checks when the URL changes.
// Both shops can switch product variants without a full page load.

let currentPageKey = null;
let productAttempts = 0;

function pageKey() {
  const listingId = SITE.listingId();
  return listingId ? `product:${listingId}` : location.pathname;
}

function routePage() {
  const key = pageKey();
  if (key === currentPageKey) {
    keepCardAttached();
    return;
  }
  currentPageKey = key;

  if (key.startsWith("product:")) {
    // A page that is still being built is checked again on the next tick.
    if (runProductPage(productAttempts)) {
      productAttempts = 0;
    } else {
      productAttempts += 1;
      currentPageKey = null;
    }
    return;
  }
  productAttempts = 0;
  cardHost = null;
  document.getElementById(CARD_ID)?.remove();
  if (SITE.isSearchPage()) startSearchBadges();
  if (SITE.isThankYouPage()) showThankYouReminder();
}

routePage();
setInterval(routePage, 1000);
