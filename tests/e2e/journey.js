// The whole shopper journey with the real extension on live shop pages, pressing controls with real mouse clicks:
// card on Amazon and Flipkart, a recorded lower-footprint choice, the shortlist, an old-device plan saved, a reminder,
// marked done from the popup (the dashboard updates without a reload), a verification request, and deleted again.
//
// Setup: cd tests/e2e && npm install
// Run:   node journey.js            (set BROWSER to a Chrome or Edge executable if it is not found)
// The test plan is deleted at the end, so the public totals are left as they were.

const path = require("node:path");
const fs = require("node:fs");
const puppeteer = require("puppeteer-core");

const EXTENSION = path.resolve(__dirname, "../../extension");
const BROWSERS = [
  process.env.BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].filter(Boolean);
const PAGES = {
  iphone: "https://www.amazon.in/dp/B0HJB7MQ97",
  galaxy: "https://www.amazon.in/dp/B0DYDPBM8K",
  galaxyFlipkart: "https://www.flipkart.com/samsung-galaxy-a56-5g-dark-blue-128-gb/p/itmee04eb4586b5a?pid=MOBHQBE6G85PXAYG",
  tea: "https://www.flipkart.com/tata-tea-premium-desh-ki-chai-pouch/p/itm01af7253c2b10?pid=TEAFVGGDNMYXFHGE",
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;

function check(name, ok, detail = "") {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

// Runs code against the card's shadow root, which page scripts cannot see directly.
function inCard(page, source) {
  return page.evaluate((code) => new Function("root", code)(document.getElementById("ecocart-card")?.shadowRoot), source);
}

// Code that finds a control inside the card's shadow root ("card") or on an ordinary page ("page").
const cardControl = (expression) => ({ where: "card", code: `return (${expression}) || null` });
const pageControl = (expression) => ({ where: "page", code: `return (${expression}) || null` });

async function handleIn(page, control) {
  const handle = await page.evaluateHandle(({ where, code }) => {
    const root = where === "card" ? document.getElementById("ecocart-card")?.shadowRoot : document;
    return new Function("root", code)(root);
  }, control);
  const element = handle.asElement();
  if (!element) throw new Error(`Control not found: ${control.code.slice(8, 100)}`);
  return element;
}

// A real mouse click at the control's position, so the test fails if the control is hidden or covered.
async function realClick(page, control) {
  const element = await handleIn(page, control);
  await element.scrollIntoView();
  await element.click();
}

async function openCard(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  // After many automated visits Amazon may ask the visitor to press "Continue shopping" first, as a person would.
  const interstitial = await page.evaluate(() => {
    const button = [...document.querySelectorAll("button, input[type=submit], a")].find((node) => /continue shopping/i.test(node.textContent || node.value || ""));
    if (!button || document.getElementById("productTitle")) return false;
    button.click();
    return true;
  });
  if (interstitial) {
    // The button leads to the home page, so open the product again.
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  }
  try {
    await page.waitForFunction(() => {
      const root = document.getElementById("ecocart-card")?.shadowRoot;
      return root && root.querySelector(".body") && !root.querySelector(".loading");
    }, { timeout: 30000 });
  } catch {
    // Say what the page showed, so a shop's robot check is not mistaken for an EcoCart bug.
    const state = await page.evaluate(() => ({
      title: document.title.slice(0, 60),
      card: Boolean(document.getElementById("ecocart-card")),
      text: (document.getElementById("ecocart-card")?.shadowRoot?.textContent || document.body.innerText).replace(/\s+/g, " ").slice(0, 120),
    }));
    throw new Error(`No finished card on ${url}: ${JSON.stringify(state)}`);
  }
  await wait(2500);
  return inCard(page, `return [...root.querySelectorAll(".step-title")].map((n) => n.textContent).join(" / ")`);
}

async function main() {
  const executablePath = BROWSERS.find((file) => fs.existsSync(file));
  if (!executablePath) throw new Error("No Chrome or Edge found. Set BROWSER to its path.");
  const browser = await puppeteer.launch({
    executablePath,
    headless: "new",
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    defaultViewport: { width: 1400, height: 1000 },
  });
  const errors = [];
  try {
    const page = await browser.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    const steps = "What we know / What this means / What you can do";

    check("phone card on Amazon in three steps", (await openCard(page, PAGES.iphone)) === steps);
    const offered = await inCard(page, `return [...root.querySelectorAll("button")].some((b) => b.textContent.includes("choose this instead"))`);
    check("same-maker lower-footprint option offered", offered);
    await realClick(page, cardControl(`[...root.querySelectorAll("button")].find((b) => b.textContent.includes("choose this instead"))`));
    await wait(1500);
    const recorded = await inCard(page, `return [...root.querySelectorAll(".choice .note")].map((n) => n.textContent).join(" ")`);
    check("choice recorded with the maker's figures", /Recorded: you chose/.test(recorded), recorded.slice(0, 80));
    check("shortlist button follows the choice", await inCard(page, `return Boolean(root.querySelector(".shortlist-state"))`));
    check("everyday comparisons shown", await inCard(page, `return root.querySelectorAll(".everyday-item").length >= 3`));

    check("phone card on Flipkart in three steps", (await openCard(page, PAGES.galaxyFlipkart)) === steps);
    check("grocery estimate on Flipkart in three steps", (await openCard(page, PAGES.tea)) === steps);
    check("estimate is labelled", await inCard(page, `return /Category estimate, not measured/i.test(root.textContent)`));
    check("report link on the card", await inCard(page, `return root.textContent.includes("Something looks wrong?")`));

    await openCard(page, PAGES.galaxy);
    await realClick(page, cardControl(`[...root.querySelectorAll("button")].find((b) => b.textContent.trim() === "Plan it")`));
    await page.waitForFunction(() => document.getElementById("ecocart-card").shadowRoot.querySelector("select[name=city]"), { timeout: 10000 });
    await (await handleIn(page, cardControl(`root.querySelector("select[name=city]")`))).select("bengaluru");
    await (await handleIn(page, cardControl(`root.querySelector("select[name=ageYears]")`))).select("4");
    await realClick(page, cardControl(`root.querySelector("form button[type=submit]")`));
    await page.waitForFunction(() => document.getElementById("ecocart-card").shadowRoot.querySelector("input[name=optionId]"), { timeout: 15000 });
    await realClick(page, cardControl(`root.querySelector(".tile")`));
    await realClick(page, cardControl(`root.querySelector(".tiles").closest("form").querySelector("button[type=submit]")`));
    const saved = await page.waitForFunction(() => /Plan saved/.test(document.getElementById("ecocart-card").shadowRoot.textContent), { timeout: 15000 }).then(() => true, () => false);
    check("old-device plan saved with real clicks", saved);
    check("preparation checklist after saving", await inCard(page, `return Boolean(root.querySelector(".prepare-steps"))`));

    const worker = await browser.waitForTarget((target) => target.type() === "service_worker");
    const extensionId = new URL(worker.url()).host;
    const dashboard = await browser.newPage();
    dashboard.on("pageerror", (error) => errors.push(error.message));
    await dashboard.goto(`chrome-extension://${extensionId}/ui/dashboard.html`);
    await wait(3000);
    const tiles = () => dashboard.evaluate(() => Object.fromEntries([...document.querySelectorAll(".tile-card")]
      .map((tile) => [tile.querySelector(".eyebrow").textContent, tile.querySelector(".tile-value").textContent])));
    const before = await tiles();
    check("dashboard counts the waiting plan", before["Plans waiting for action"] === "01", JSON.stringify(before));
    check("dashboard counts the choice", Number(before["Footprint difference of your choices"]) > 0);

    await realClick(dashboard, pageControl(`document.getElementById("tab-actions")`));
    await dashboard.evaluate(() => {
      const input = document.querySelector(".reminder input[type=date]");
      input.value = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
      input.dispatchEvent(new Event("change"));
    });
    await wait(1500);
    check("reminder set, with a calendar file to add", await dashboard.evaluate(() => [...document.querySelectorAll(".plan button")].some((b) => b.textContent === "Add to calendar")));

    const popup = await browser.newPage();
    await popup.goto(`chrome-extension://${extensionId}/ui/popup.html`);
    await popup.waitForSelector(".action", { timeout: 15000 });
    await realClick(popup, pageControl(`[...document.querySelectorAll(".action button")].find((b) => b.textContent === "Mark done")`));
    await wait(4000);
    await dashboard.bringToFront();
    await wait(1500);
    await realClick(dashboard, pageControl(`document.getElementById("tab-overview")`));
    const after = await tiles();
    check("dashboard updates live when the popup marks it done", after["Handed over, reported by you"] === "01", JSON.stringify(after));

    await realClick(dashboard, pageControl(`document.getElementById("tab-actions")`));
    const note = await handleIn(dashboard, pageControl(`document.querySelector(".verify input")`));
    await note.type("Test reference 0000, delete me");
    await realClick(dashboard, pageControl(`[...document.querySelectorAll(".verify button")].find((b) => b.textContent === "Ask for verification")`));
    await wait(3500);
    check("verification requested from the dashboard", await dashboard.evaluate(() => document.body.textContent.includes("You asked for verification")));

    await realClick(dashboard, pageControl(`[...document.querySelectorAll(".plan button")].find((b) => b.textContent === "Delete")`));
    await wait(3000);
    check("test plan deleted", (await dashboard.evaluate(() => document.querySelectorAll(".plan").length)) === 0);
  } finally {
    check("no script errors", errors.length === 0, errors.slice(0, 3).join(" | "));
    await browser.close();
  }
}

main()
  .catch((error) => {
    failures += 1;
    console.log(`FAIL  ${error.message}`);
  })
  .finally(() => {
    console.log(failures ? `${failures} failed` : "All passed");
    process.exitCode = failures ? 1 : 0;
  });
