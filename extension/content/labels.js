// Labels the listing itself states: the BEE star rating, environmental certifications, and Amazon's
// own sustainability badge when the page shows one. None of this is verified by EcoCart, and the card says so.

// [name, what it covers, pattern in the listing text, the scheme's official site]
const CERTIFICATIONS = [
  ["GOTS", "Organic fibre textiles, checked through the supply chain", /\bGOTS\b|global organic textile standard/i, "https://global-standard.org/"],
  ["OEKO-TEX", "Textiles tested for harmful substances", /\boeko[\s-]?tex\b/i, "https://www.oeko-tex.com/"],
  ["Global Recycled Standard", "Recycled content in textiles and other goods", /global recycled standard|\bGRS[\s-]certified\b/i, "https://textileexchange.org/"],
  ["FSC", "Wood or paper from responsibly managed forests", /\bFSC\b|forest stewardship council/i, "https://fsc.org/"],
  ["PEFC", "Wood or paper from certified forests", /\bPEFC\b/, "https://pefc.org/"],
  ["Fairtrade", "Fair terms for farmers and workers", /\bfair ?trade\b/i, "https://www.fairtrade.net/"],
  ["Jaivik Bharat / India Organic", "Organic food under India's national standard", /jaivik bharat|india organic|\bNPOP\b/i, "https://jaivikbharat.fssai.gov.in/"],
  ["USDA Organic", "Organic under the US standard", /\bUSDA[\s-]organic\b/i, "https://www.ams.usda.gov/about-ams/programs-offices/national-organic-program"],
  ["Ecomark", "India's eco-label for products with lower environmental impact", /\beco[\s-]?mark\b/i, "https://www.bis.gov.in/"],
  ["Cradle to Cradle", "Material health, reuse and recycling", /cradle to cradle/i, "https://c2ccertified.org/"],
];

const STAR_DETAIL = /energy|bee|star rating/i;
const STAR_TEXT = /\b(?:bee|energy)\b[^|,;.]{0,25}?\b([1-5])[\s-]*star|\b([1-5])[\s-]*star\b[^|,;.]{0,25}?\b(?:bee|energy)\b/i;

// The BEE star label as the listing states it: from the details table first, then the title or bullet points.
function energyStars(page) {
  for (const [label, value] of Object.entries(page.details)) {
    if (!STAR_DETAIL.test(label)) continue;
    const stars = /([1-5])\s*star/i.exec(value);
    if (stars) return Number(stars[1]);
  }
  const match = STAR_TEXT.exec([page.title, ...(page.bullets || [])].join(" | "));
  return match ? Number(match[1] || match[2]) : null;
}

function listingCertifications(page) {
  const text = [page.title, ...Object.values(page.details), ...(page.bullets || []), page.description || ""].join(" | ");
  return CERTIFICATIONS.filter(([, , pattern]) => pattern.test(text));
}

// Nothing is shown when the listing states no label at all.
function renderLabels(page) {
  const certifications = listingCertifications(page);
  const badge = page.shopBadge;
  if (certifications.length === 0 && !badge) return null;
  return el("div", { className: "labels" },
    el("p", { className: "eyebrow" }, "Labels on this listing"),
    badge ? el("p", { className: "label-row" }, el("span", { className: "label-name" }, `${SITE.name} badge`), badge) : null,
    certifications.map(([name, about, , url]) => el("p", { className: "label-row" },
      el("span", { className: "label-name" }, name), `${about}. `, sourceLink(url, "About the scheme"))),
    el("p", { className: "note" }, "Stated by the seller or shop. EcoCart has not checked that this product holds them."),
  );
}

// Lets the Node tests load this file. The browser ignores it.
if (typeof module !== "undefined") module.exports = { energyStars, listingCertifications };
