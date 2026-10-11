// Helpers shared by the content scripts. Content scripts run as classic scripts in one
// shared scope, in the order listed in manifest.json, so these are plain globals.

const DOT = " · ";
const ARROW = "↗";
const DIRECTION_MARKS = new RegExp(`[${String.fromCharCode(0x200e, 0x200f)}]`, "g");
const VIEWED_KEY = "viewedPhones";
const MAX_VIEWED = 20;

// ---------- Device categories ----------

const DEVICE_WORDS = {
  phone: "phone", laptop: "laptop", tablet: "tablet", watch: "watch", earbuds: "earbuds",
  tv: "TV", appliance: "appliance", electronics: "device",
};

// Accessory titles often name the device they fit, so they must never be treated as the device.
const ACCESSORY_WORDS = /\b(case|cases|cover|covers|tempered|glass|screen guard|protector|charger|cable|adapter|skin|holder|stand|pouch|strap|straps|band|lens|sleeve|bag|backpack|keyboard|mouse|stylus|pencil|tips|dock|mount|film|refill)\b/i;

// [category, breadcrumb item (or Generic Name) that means the category, title words used only when a page has neither]
const CATEGORY_RULES = [
  ["phone", /^(smart ?phones?|mobiles?|mobile phones?|smartphones & basic mobiles|iphones?|cell ?phones?)$/i,
    /\b(smart ?phone|mobile phone|iphone|galaxy [asmz]\d+|pixel \d+a?|oneplus (nord|\d+r?)|redmi( note)? \d+|realme \w*\d+|vivo [vtxy]\d+|oppo (reno|[af]\d+)|iqoo \w*\d+|moto(rola)? (edge|g\d+)|nothing phone|poco [xmfc]\d+)\b/i],
  ["laptop", /^((traditional|gaming|2 in 1|thin and light) )?laptops?$|^(notebook computers?|macbooks?|chromebooks?)$/i,
    /\b(laptop|macbook|chromebook|notebook pc)\b/i],
  ["tablet", /^(tablets?|ipads?|android tablets?)$/i, /\b(tablet|ipad|galaxy tab)\b/i],
  ["watch", /^(smart ?watch(es)?|apple watch|fitness trackers?)$/i, /\b(smart ?watch|apple watch|galaxy watch)\b/i],
  ["earbuds", /^(earbuds|true wireless( earbuds)?|tws earbuds|wireless earphones|in-ear|airpods)$/i, /\b(earbuds|airpods|true wireless|tws)\b/i],
  ["tv", /^((smart|led|oled|qled|4k ultra hd|full hd) )?(televisions?|tvs?)$/i, /\b(smart tv|television|led tv|oled tv|qled tv)\b/i],
  ["appliance",
    /^(refrigerators?|washing machines?( & dryers)?|(split |window )?air conditioners?|microwave ovens?|microwaves?|dishwashers?|water purifiers?|air purifiers?|water heaters?|geysers?|chimneys?|vacuum cleaners?|air coolers?|large appliances)$/i,
    /\b(refrigerator|washing machine|air conditioner|split ac|window ac|microwave oven|dishwasher|water purifier)\b/i],
];

// Any other electronic device, recognised from the shop's breadcrumb only.
const ELECTRONICS_CRUMB = /^(electronics|computers & accessories|computers|audio & video|audio|home audio|speakers|headphones|cameras( & photography)?|gaming|video games|wearable technology|wearable smart devices|printers|monitors|networking devices|home entertainment systems)$/i;
// The most specific breadcrumb names accessories this way: "Cases & Covers", "Mobile Accessories".
const ACCESSORY_CRUMB = /accessor|case|cover|cable|charger|protector|strap|bag|backpack|sleeve|skin|mount|stand|holder|batter|memory card|power bank/i;

function firstIndex(pattern, text) {
  const match = pattern.exec(text);
  return match ? match.index : -1;
}

// An accessory names what it is before the device it fits: "Sport Band for Apple Watch".
// A device may mention accessory words after its own name: "Apple Watch SE 3 with Sport Band".
function looksLikeAccessory(title, deviceIndex) {
  const accessoryIndex = firstIndex(ACCESSORY_WORDS, title);
  return accessoryIndex >= 0 && (deviceIndex < 0 || accessoryIndex < deviceIndex);
}

// The shop's breadcrumb decides. The title is a fallback for pages that have no breadcrumb at all.
// The device named first wins: "Apple Watch Series 11, works with iPhone" is a watch.
function categoryFromTitle(title) {
  const found = CATEGORY_RULES
    .map(([category, , titleRule]) => [category, firstIndex(titleRule, title)])
    .filter(([, index]) => index >= 0)
    .sort((a, b) => a[1] - b[1])[0];
  return found && !looksLikeAccessory(title, found[1]) ? found[0] : null;
}

// The shop's breadcrumb decides. Without one, the listing's category details stand in (fromDetails), and as those
// are sometimes a model name ("iPhone Air", "Apple Watch Series 11"), device names are checked in them and the title too.
function detectCategory(crumbs, title, fromDetails = false) {
  for (const [category, crumbRule] of CATEGORY_RULES) {
    if (crumbs.some((crumb) => crumbRule.test(crumb))) return category;
  }
  const specific = crumbs[crumbs.length - 1];
  if (specific && ACCESSORY_CRUMB.test(specific)) return null;
  if (crumbs.length > 0 && !fromDetails) {
    return crumbs.some((crumb) => ELECTRONICS_CRUMB.test(crumb)) ? "electronics" : null;
  }
  return categoryFromTitle(`${specific || ""} ${title}`.trim())
    || (crumbs.some((crumb) => ELECTRONICS_CRUMB.test(crumb)) ? "electronics" : null);
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function clean(text) {
  return (text || "").replace(DIRECTION_MARKS, "").replace(/\s+/g, " ").trim();
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "className") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function show(parent, ...children) {
  parent.replaceChildren(...children.flat().filter(Boolean));
}

function sourceLink(url, label = "Source") {
  return url ? el("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, `${label} ${ARROW}`) : null;
}

function button(label, onClick, variant = "primary", type = "button") {
  return el("button", { className: `btn ${variant}`, type, onClick }, label);
}

function formatDate(text) {
  const [year, month, day] = String(text).split("-").map(Number);
  if (!year || !month) return text;
  return new Date(year, month - 1, day || 1).toLocaleDateString("en-IN", {
    day: day ? "numeric" : undefined,
    month: "short",
    year: "numeric",
  });
}

function formatNumber(value) {
  return Number(value).toLocaleString("en-IN");
}

function formatRupees(value) {
  return `₹${formatNumber(value)}`;
}

async function api(method, path, body, auth = false) {
  const response = await chrome.runtime.sendMessage({ type: "api", method, path, body, auth });
  if (!response?.ok) throw new Error(response?.error || "No response from EcoCart");
  return response.data;
}

function logoBar(tagText, extra) {
  return el("header", { className: "bar" },
    el("span", { className: "logo" }, el("span", { className: "mark", "aria-hidden": "true" }), "EcoCart"),
    el("span", { className: "tag" }, tagText),
    extra,
  );
}

// The card's typefaces, bundled with the extension. Fonts declared inside a shadow root are not loaded, so they are
// registered on the page under EcoCart's own names, which cannot clash with the shop's fonts.
const FONTS = [
  ["EcoCart Sans", "instrument-sans.woff2", { weight: "400 700" }],
  ["EcoCart Serif", "instrument-serif.woff2", {}],
  ["EcoCart Serif", "instrument-serif-italic.woff2", { style: "italic" }],
  ["EcoCart Mono", "jetbrains-mono.woff2", { weight: "400 600" }],
];
let fontsRegistered = false;

function registerFonts() {
  if (fontsRegistered) return;
  fontsRegistered = true;
  for (const [family, file, descriptors] of FONTS) {
    const face = new FontFace(family, `url("${chrome.runtime.getURL(`fonts/${file}`)}")`, descriptors);
    face.load().then((loaded) => document.fonts.add(loaded)).catch(() => {
      // The card falls back to system fonts.
    });
  }
}

// Creates a host element with its own shadow root so Amazon's styles cannot leak in.
function mountShadow(id, place, stylesheet) {
  registerFonts();
  document.getElementById(id)?.remove();
  const host = el("div", { id });
  place(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.append(el("link", { rel: "stylesheet", href: chrome.runtime.getURL(stylesheet) }));
  return shadow;
}

async function recentlyViewed() {
  const stored = await chrome.storage.local.get(VIEWED_KEY);
  return stored[VIEWED_KEY] || [];
}

// Kept only in this browser. Used by the dashboard and the order-page reminder.
async function recordView(card) {
  const entry = {
    modelId: card.product.modelId,
    displayName: card.product.displayName,
    category: card.product.category,
    brand: card.product.brand,
    headline: card.headline,
    carbonKg: card.carbon?.kg ?? null,
    carbonSource: card.carbon?.source ?? null,
    viewedAt: new Date().toISOString(),
  };
  const others = (await recentlyViewed()).filter((item) => item.modelId !== entry.modelId);
  await chrome.storage.local.set({ [VIEWED_KEY]: [entry, ...others].slice(0, MAX_VIEWED) });
}

// Lets the Node tests load this file. The browser ignores it.
if (typeof module !== "undefined") module.exports = { detectCategory };
