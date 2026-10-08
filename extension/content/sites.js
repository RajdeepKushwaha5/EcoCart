// One reader per shop. Each returns the same shapes, so the card, search badges and order-page
// reminder work the same way everywhere. Selectors were checked against live pages in September 2026.

function crumbsFrom(nodes) {
  return [...nodes].map((node) => clean(node.textContent)).filter(Boolean);
}

// Amazon's Best Sellers Rank names the categories a product sits in: "#189 in Books (See Top 100 in Books) #1 in Fantasy".
function rankCategories(text) {
  return [...String(text || "").matchAll(/#[\d,]+ in ([^#(]+?)\s*(?=\(|#|$)/g)].map((match) => clean(match[1])).filter(Boolean);
}

// Some pages have no breadcrumb (brand stores such as Apple's). Then the listing's own category details stand in for it,
// broadest first: the Best Sellers Rank categories, then the Generic Name, which Indian rules require on every listing.
function categoryFallback(details, rankText) {
  const generic = Object.entries(details).find(([label]) => /^generic name$/i.test(label))?.[1];
  const hints = [...rankCategories(rankText), generic].map(clean).filter(Boolean);
  return [...new Set(hints)].slice(0, 6);
}

function numberFrom(text) {
  const value = Number.parseFloat(String(text || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

// ---------- Amazon.in ----------

const AMAZON_DETAIL_ROWS = [
  "#productDetails_techSpec_section_1 tr",
  "#productDetails_detailBullets_sections1 tr",
  "#technicalSpecifications_section_1 tr",
].join(", ");
// Most specific first. "priceToPay" is the selling price; plain ".a-price" can be the struck-out M.R.P.
// Amazon often leaves ".a-offscreen" empty, so the visible whole-rupee part is the fallback.
const AMAZON_PRICES = [
  "#corePriceDisplay_desktop_feature_div .priceToPay .a-offscreen",
  "#corePriceDisplay_desktop_feature_div .priceToPay .a-price-whole",
  "#corePriceDisplay_desktop_feature_div .apexPriceToPay .a-offscreen",
  "#corePrice_feature_div .a-price .a-offscreen",
  "#apex_desktop .priceToPay .a-price-whole",
  "#apex_desktop .a-price .a-offscreen",
  // Brand stores (Apple's, for one) skip the "priceToPay" wrapper.
  "#corePriceDisplay_desktop_feature_div .a-price:not(.a-text-price) .a-price-whole",
];
// Last resort: the price the add-to-cart form will submit.
const AMAZON_CART_PRICE = 'input[name="items[0.base][customerVisiblePrice][amount]"]';
// Newer layouts repeat the price in the narrow buy box, so the centre column is searched first.
const AMAZON_PRICE_BLOCK = "#corePriceDisplay_desktop_feature_div, #corePrice_feature_div, #apex_desktop";
const AMAZON_CENTRE_PRICE = AMAZON_PRICE_BLOCK.split(", ").map((selector) => `#centerCol ${selector}`).join(", ");
const AMAZON_RESULT = '[data-component-type="s-search-result"][data-asin]';
// "About this item": most pages use #feature-bullets, clothing pages use the product facts block.
const AMAZON_BULLETS = "#feature-bullets li, #productFactsDesktopExpander li";
// Long descriptions are cut, so a page with pages of text stays quick to read.
const DESCRIPTION_LIMIT = 4000;
// Amazon's sustainability badge. The containers are on every Amazon.in page but are usually empty.
const AMAZON_BADGE = "#climatePledgeFriendlyATF_feature_div, #climatePledgeFriendlyBTF_feature_div";

const AMAZON = {
  name: "Amazon",
  // The product page arrives complete from the server.
  rendersLate: false,

  listingId() {
    return /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/.exec(location.pathname)?.[1] ?? null;
  },

  readProductPage() {
    const title = clean(document.querySelector("#productTitle")?.textContent);
    if (!title) return null;

    const details = {};
    for (const row of document.querySelectorAll(AMAZON_DETAIL_ROWS)) {
      const label = clean(row.querySelector("th")?.textContent);
      const value = clean(row.querySelector("td")?.textContent);
      if (label && value) details[label] = value;
    }
    for (const item of document.querySelectorAll("#detailBullets_feature_div li")) {
      const bold = item.querySelector(".a-text-bold");
      if (!bold) continue;
      const label = clean(bold.textContent).replace(/:$/, "").trim();
      const value = clean(item.textContent.replace(bold.textContent, ""));
      if (label && value) details[label] = value;
    }

    const price = AMAZON_PRICES.map((selector) => numberFrom(document.querySelector(selector)?.textContent))
      .find((value) => value !== null) ?? numberFrom(document.querySelector(AMAZON_CART_PRICE)?.value);
    const buyBox = clean(document.querySelector("#buybox, #desktop_buybox")?.textContent);
    const badge = [...document.querySelectorAll(AMAZON_BADGE)].map((node) => clean(node.innerText)).find(Boolean);
    const breadcrumb = crumbsFrom(document.querySelectorAll("#wayfinding-breadcrumbs_feature_div a"));
    const rank = details["Best Sellers Rank"] || "";
    return {
      title,
      details,
      price,
      crumbs: breadcrumb.length ? breadcrumb : categoryFallback(details, rank),
      crumbsFromDetails: breadcrumb.length === 0,
      bullets: [...new Set([...document.querySelectorAll(AMAZON_BULLETS)].map((item) => clean(item.textContent)).filter(Boolean))],
      description: clean(document.querySelector("#productDescription")?.textContent).slice(0, DESCRIPTION_LIMIT),
      shopBadge: badge ? badge.slice(0, 200) : null,
      showsExchange: /with exchange/i.test(buyBox),
      // No featured offer: Amazon lists sellers only behind "See All Buying Options".
      noFeaturedOffer: price === null && /see all buying options/i.test(buyBox),
    };
  },

  // Below the price, so the shopper still sees the title and price first.
  placeCard(host) {
    const anchor = document.querySelector(AMAZON_CENTRE_PRICE) || document.querySelector("#titleSection, #title_feature_div")
      || document.querySelector(AMAZON_PRICE_BLOCK);
    if (anchor) {
      anchor.after(host);
      return true;
    }
    const column = document.querySelector("#centerCol");
    if (!column) return false;
    column.prepend(host);
    return true;
  },

  isSearchPage() {
    return location.pathname === "/s" || document.querySelector(AMAZON_RESULT) !== null;
  },

  searchResults() {
    return [...document.querySelectorAll(AMAZON_RESULT)].map((node) => {
      // Some layouts put the brand in its own h2; the longest one is the product title.
      const heading = [...node.querySelectorAll("h2")]
        .sort((a, b) => b.textContent.length - a.textContent.length)[0];
      return { node, title: clean(heading?.textContent), anchor: heading };
    });
  },

  isThankYouPage() {
    return /thankyou/i.test(location.pathname);
  },

  searchUrl(query) {
    return `https://www.amazon.in/s?k=${encodeURIComponent(query)}`;
  },

  // Reads a search results page in the background. Same site, so the shopper's own session is used and nothing
  // leaves the browser except the request Amazon would get from typing the search.
  async readSearchPage(query) {
    const response = await fetch(this.searchUrl(query), { credentials: "include" });
    if (!response.ok) return [];
    const doc = new DOMParser().parseFromString(await response.text(), "text/html");
    return [...doc.querySelectorAll(AMAZON_RESULT)].slice(0, 20).map((node) => {
      const heading = [...node.querySelectorAll("h2")].sort((a, b) => b.textContent.length - a.textContent.length)[0];
      const link = node.querySelector('a[href*="/dp/"]');
      return {
        title: clean(heading?.textContent),
        price: numberFrom(node.querySelector(".a-price:not(.a-text-price) .a-offscreen")?.textContent
          || node.querySelector(".a-price-whole")?.textContent),
        url: link ? new URL(link.getAttribute("href"), location.origin).href.split("/ref=")[0] : null,
      };
    }).filter((result) => result.title && result.url);
  },
};

// ---------- Flipkart ----------

const FLIPKART_RESULT = "[data-id]";

// Name and price come from the page's schema.org Product data, which is steadier than Flipkart's class names.
function flipkartProductData() {
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(script.textContent);
      const product = (Array.isArray(data) ? data : [data]).find((item) => item?.["@type"] === "Product");
      if (product) return product;
    } catch {
      // Ignore blocks that are not valid JSON.
    }
  }
  return null;
}

function flipkartCrumbs() {
  const home = [...document.querySelectorAll("a")].find((link) => clean(link.textContent) === "Home");
  let container = home?.parentElement;
  for (let depth = 0; container && depth < 5; depth += 1) {
    if (container.querySelectorAll("a").length >= 3) {
      return crumbsFrom(container.querySelectorAll("a")).filter((crumb) => crumb !== "Home");
    }
    container = container.parentElement;
  }
  return [];
}

const FLIPKART = {
  name: "Flipkart",
  // The page is built in the browser, so the title and breadcrumb can arrive a moment after load.
  rendersLate: true,

  listingId() {
    if (!location.pathname.includes("/p/itm")) return null;
    return new URLSearchParams(location.search).get("pid") || /\/p\/(itm[0-9a-z]+)/i.exec(location.pathname)?.[1] || null;
  },

  readProductPage() {
    const data = flipkartProductData();
    const title = clean(document.querySelector("h1")?.textContent) || clean(data?.name);
    if (!title) return null;

    const details = {};
    for (const row of document.querySelectorAll("table tr")) {
      const cells = row.querySelectorAll("td");
      if (cells.length === 2) details[clean(cells[0].textContent)] = clean(cells[1].textContent);
      if (Object.keys(details).length >= 60) break;
    }
    const offers = Array.isArray(data?.offers) ? data.offers[0] : data?.offers;
    return {
      title,
      details,
      price: numberFrom(offers?.price ?? offers?.lowPrice),
      crumbs: flipkartCrumbs(),
      crumbsFromDetails: false,
      bullets: [],
      description: clean(data?.description).slice(0, DESCRIPTION_LIMIT),
      shopBadge: null,
      showsExchange: /buy with exchange/i.test(document.body.textContent),
    };
  },

  // Right after the smallest block that holds both the title and the price.
  placeCard(host) {
    const title = document.querySelector("h1");
    if (!title) return false;
    const offers = flipkartProductData()?.offers;
    const price = numberFrom((Array.isArray(offers) ? offers[0] : offers)?.price);
    // Digits only: Flipkart renders the rupee sign in its own element.
    const priceText = price ? price.toLocaleString("en-IN") : null;

    let block = title;
    for (let depth = 0; priceText && depth < 8 && block.parentElement; depth += 1) {
      block = block.parentElement;
      if (block.textContent.includes(priceText)) {
        block.after(host);
        return true;
      }
    }
    // No price found nearby: stay close to the title.
    block = title.parentElement?.parentElement || title;
    block.after(host);
    return true;
  },

  isSearchPage() {
    return location.pathname.startsWith("/search") || document.querySelector('[data-id] a[href*="/p/itm"]') !== null;
  },

  searchResults() {
    return [...document.querySelectorAll(FLIPKART_RESULT)]
      .filter((node) => node.querySelector('a[href*="/p/itm"]'))
      .map((node) => {
        const title = clean(node.querySelector("img[alt]")?.getAttribute("alt"));
        const label = [...node.querySelectorAll("div, a")]
          .find((element) => element.childElementCount === 0 && clean(element.textContent) === title);
        return { node, title, anchor: label || node.querySelector('a[href*="/p/itm"]') };
      });
  },

  isThankYouPage() {
    return /orderresponse|order-?confirmation/i.test(location.pathname);
  },

  searchUrl(query) {
    return `https://www.flipkart.com/search?q=${encodeURIComponent(query)}`;
  },
};

const SITE = location.hostname.endsWith("flipkart.com") ? FLIPKART : AMAZON;
