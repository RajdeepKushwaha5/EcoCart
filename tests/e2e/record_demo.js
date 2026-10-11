// Records the README demo on live Amazon.in and Flipkart pages with the real extension, as timestamped frames.
// It saves one old-device plan on camera and deletes it afterwards, so the public totals are left as they were.
//
// Run:   node record_demo.js                      (frames go to tests/e2e/demo-frames)
// Build: python build_demo_video.py, then with ffmpeg:
//   ffmpeg -f concat -safe 0 -i demo-frames/list.txt -vf "fps=24,scale=1280:-2" -c:v libx264 -pix_fmt yuv420p -crf 24 -movflags +faststart ../../docs/demo/ecocart-demo.mp4
//   ffmpeg -i ../../docs/demo/ecocart-demo.mp4 -vf "fps=8,scale=800:-1" -c:v libwebp_anim -quality 70 -loop 0 ../../docs/demo/ecocart-demo.webp
const fs = require("node:fs");
const path = require("node:path");
const puppeteer = require("puppeteer-core");

const EXT = path.resolve(__dirname, "../../extension");
const OUT = path.resolve(__dirname, "demo-frames");
const W = 1280;
const H = 800;
const SCALE = 2;
// Product scenes show a 720x450 window around the card, scaled up to the 1280x800 video; other scenes show the full view.
const FOCUS_W = 720;
const FOCUS_H = 450;
let focus = null;
const URLS = {
  search: "https://www.amazon.in/s?k=samsung+galaxy+phone",
  iphone: "https://www.amazon.in/dp/B0HJB7MQ97",
  haier: "https://www.amazon.in/dp/B0GP76MN24",
  whirlpool: "https://www.amazon.in/dp/B0GHMN7MY8",
  tea: "https://www.flipkart.com/tata-tea-premium-desh-ki-chai-pouch/p/itm01af7253c2b10?pid=TEAFVGGDNMYXFHGE",
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const frames = [];
let recording = false;
let paused = false;
let castStart = null; // set once the screencast session exists; the screencast stops on every navigation

async function go(page, url) {
  paused = true;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  const interstitial = await page.evaluate(() => {
    const button = [...document.querySelectorAll("button, input[type=submit], a")].find((n) => /continue shopping/i.test(n.textContent || n.value || ""));
    if (!button || document.getElementById("productTitle") || document.querySelector("[data-component-type='s-search-result']")) return false;
    button.click();
    return true;
  });
  if (interstitial) {
    await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  }
}

const ready = (page) => page.waitForFunction(() => {
  const r = document.getElementById("ecocart-card")?.shadowRoot;
  return r && r.querySelector(".body") && !r.querySelector(".loading");
}, { timeout: 45000 });

const inCard = (page, code) => page.evaluateHandle((c) => new Function("root", c)(document.getElementById("ecocart-card").shadowRoot), code);

async function caption(page, step, text) {
  await page.evaluate((step, text, focus, FOCUS_H) => {
    let box = document.getElementById("ecodemo-caption");
    if (!box) {
      box = document.createElement("div");
      box.id = "ecodemo-caption";
      box.style.cssText = "position:fixed;left:24px;bottom:24px;z-index:2147483647;display:flex;align-items:center;gap:14px;"
        + "background:#1b3320;color:#fff;font:600 21px/1.3 'Segoe UI',system-ui,sans-serif;padding:14px 20px;border-radius:14px;"
        + "box-shadow:0 10px 30px rgba(0,0,0,.28);max-width:760px;pointer-events:none";
      document.documentElement.append(box);
    }
    if (focus) {
      Object.assign(box.style, { left: `${focus.x + 12}px`, top: `${FOCUS_H - 58}px`, bottom: "auto", font: "600 13px/1.3 'Segoe UI',system-ui,sans-serif",
        padding: "8px 12px", gap: "9px", borderRadius: "10px", maxWidth: "690px" });
    } else {
      Object.assign(box.style, { left: "24px", top: "auto", bottom: "28px", font: "600 26px/1.3 'Segoe UI',system-ui,sans-serif",
        padding: "16px 24px", gap: "16px", borderRadius: "16px", maxWidth: "1100px" });
    }
    box.innerHTML = "";
    if (step) {
      const n = document.createElement("span");
      n.textContent = step;
      const size = focus ? 22 : 40;
      n.style.cssText = `flex:none;display:grid;place-items:center;width:${size}px;height:${size}px;border-radius:50%;background:#7cc576;color:#10240f;font-size:${focus ? 12 : 20}px`;
      box.append(n);
    }
    const t = document.createElement("span");
    t.textContent = text;
    box.append(t);
  }, step, text, focus, FOCUS_H);
  paused = false;
}

async function pointer(page) {
  await page.evaluate(() => {
    if (document.getElementById("ecodemo-pointer")) return;
    const dot = document.createElement("div");
    dot.id = "ecodemo-pointer";
    dot.style.cssText = "position:fixed;left:640px;top:400px;width:26px;height:26px;margin:-13px 0 0 -13px;border-radius:50%;"
      + "background:rgba(233,139,184,.55);border:3px solid #b8437f;z-index:2147483647;pointer-events:none;"
      + "transition:left .7s cubic-bezier(.22,1,.36,1),top .7s cubic-bezier(.22,1,.36,1),transform .15s";
    document.documentElement.append(dot);
  });
}

// Moves the visible pointer to the element, then clicks it.
async function clickOn(page, handle) {
  await handle.evaluate((n) => {
    const r = n.getBoundingClientRect();
    if (r.top < 60 || r.bottom > 400) n.scrollIntoView({ block: "center", behavior: "instant" });
  });
  await wait(300);
  await pointer(page);
  const box = await handle.boundingBox();
  if (!box) throw new Error("not visible");
  await page.evaluate((x, y) => {
    const dot = document.getElementById("ecodemo-pointer");
    dot.style.left = `${x}px`;
    dot.style.top = `${y}px`;
  }, box.x + box.width / 2, box.y + box.height / 2);
  await wait(750);
  await page.evaluate(() => { document.getElementById("ecodemo-pointer").style.transform = "scale(.7)"; });
  await handle.click();
  await wait(150);
  await page.evaluate(() => { const d = document.getElementById("ecodemo-pointer"); if (d) d.style.transform = ""; });
}

async function focusOnCard(page) {
  const box = await page.evaluate(() => {
    const r = document.getElementById("ecocart-card").getBoundingClientRect();
    return { left: r.left, width: r.width };
  });
  focus = { x: Math.round(Math.min(Math.max(box.left + box.width / 2 - FOCUS_W / 2, 0), W - FOCUS_W)) };
}

async function scrollToHandle(page, handle, offset = 90) {
  await handle.evaluate((n, offset) => {
    const top = n.getBoundingClientRect().top + window.scrollY - offset;
    window.scrollTo({ top, behavior: "instant" });
  }, offset);
  await wait(500);
}

async function slowScroll(page, by, ms) {
  const steps = Math.round(ms / 40);
  for (let i = 0; i < steps; i += 1) {
    await page.evaluate((d) => window.scrollBy(0, d), by / steps);
    await wait(40);
  }
}

async function titleCard(page, title, subtitle) {
  await page.setContent(`<!doctype html><html><body style="margin:0;height:100vh;display:grid;place-items:center;background:#fbfaf3;
    font-family:'Segoe UI',system-ui,sans-serif;color:#1b3320"><div style="text-align:center">
    <div style="display:inline-flex;align-items:center;gap:14px;font:700 64px/1 'Segoe UI',system-ui"><span style="width:26px;height:26px;border-radius:7px;background:#2f7a3b"></span>EcoCart</div>
    <p style="font-size:28px;margin:22px 0 0">${title}</p><p style="font-size:19px;color:#4a5a4d;margin:12px 0 0">${subtitle}</p></div></body></html>`);
  paused = false;
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: [process.env.BROWSER, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome"].filter(Boolean).find((file) => fs.existsSync(file)),
    headless: "new",
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, `--window-size=${W},${H}`],
    defaultViewport: { width: W, height: H, deviceScaleFactor: SCALE },
  });
  const page = await browser.newPage();
  const worker = await browser.waitForTarget((t) => t.type() === "service_worker");
  const extensionId = new URL(worker.url()).host;

  // Off camera: shortlist the Haier, so the Whirlpool card can compare with it.
  await go(page, URLS.haier);
  await ready(page);
  await wait(1500);
  const shortlist = await inCard(page, `return [...root.querySelectorAll("button")].find((b) => /add to my shortlist/i.test(b.textContent)) || null`);
  if (shortlist.asElement()) await shortlist.asElement().click();
  await wait(1200);
  await page.goto("about:blank");

  // Screenshots in a loop, timestamped: works across navigations, unlike a headless screencast.
  recording = true;
  const capture = (async () => {
    let clock = 0; // video time: only advances while not paused
    let last = Date.now() / 1000;
    while (recording) {
      const now = Date.now() / 1000;
      if (paused) { last = now; await wait(40); continue; }
      clock += now - last;
      last = now;
      const t = clock;
      try {
        const scrollY = await page.evaluate(() => window.scrollY);
        const clip = focus
          ? { x: focus.x, y: scrollY, width: FOCUS_W, height: FOCUS_H, scale: W / FOCUS_W / SCALE }
          : { x: 0, y: scrollY, width: W, height: H, scale: 1 / SCALE };
        const data = await page.screenshot({ type: "jpeg", quality: 82, optimizeForSpeed: true, clip });
        if (!recording) break;
        const file = path.join(OUT, `${String(frames.length).padStart(5, "0")}.jpg`);
        fs.writeFileSync(file, data);
        frames.push({ file, t });
      } catch {
        await wait(50); // mid-navigation
      }
    }
  })();

  const scene = async (name, fn) => {
    try {
      await fn();
    } catch (error) {
      console.log(`Scene "${name}" failed: ${error.message}`);
    }
  };

  await scene("title", async () => {
    await titleCard(page, "Shop with the facts on Amazon.in and Flipkart", "A browser extension. Every figure sourced, every estimate labelled.");
    await wait(2500);
  });

  await scene("search", async () => {
    focus = null;
    await go(page, URLS.search);
    await page.waitForFunction(() => document.querySelectorAll(".ecocart-badge-host").length >= 4, { timeout: 30000 });
    await caption(page, "1", "Search results: an EcoCart badge on every result");
    const first = await page.$(".ecocart-badge-host");
    await scrollToHandle(page, first, 300);
    await wait(1200);
    await slowScroll(page, 600, 2600);
    await wait(1000);
  });

  await scene("iphone card", async () => {
    await go(page, URLS.iphone);
    await ready(page);
    await focusOnCard(page);
    await caption(page, "2", "Product page: the maker's own facts, in plain words");
    await wait(800);
    const card = (await page.waitForFunction(() => document.getElementById("ecocart-card"), { timeout: 20000 })).asElement();
    await scrollToHandle(page, card, 70);
    await wait(3000);
    await slowScroll(page, 300, 1600);
    await wait(1800);
  });

  await scene("choose", async () => {
    await caption(page, "3", "Same maker, similar price, lower reported footprint: choose it");
    const choose = (await inCard(page, `return [...root.querySelectorAll("button")].find((b) => b.textContent.includes("choose this instead"))`)).asElement();
    await clickOn(page, choose);
    await wait(2500);
    const ok = (await inCard(page, `return root.querySelector(".celebrate .btn")`)).asElement();
    if (ok) await clickOn(page, ok);
    await wait(800);
    const bought = (await inCard(page, `return [...root.querySelectorAll("button")].find((b) => b.textContent === "I bought this")`)).asElement();
    if (bought) {
      await caption(page, "3", "Bought it? One tap logs it in your purchases");
      await clickOn(page, bought);
      await wait(1700);
    }
  });

  await scene("old phone", async () => {
    await caption(page, "4", "Plan for the old phone: three quick questions");
    const plan = (await inCard(page, `return [...root.querySelectorAll("button")].find((b) => b.textContent.trim() === "Plan it")`)).asElement();
    await clickOn(page, plan);
    await page.waitForFunction(() => document.getElementById("ecocart-card").shadowRoot.querySelector("select[name=city]"), { timeout: 10000 });
    for (const [name, value] of [["brand", "Samsung"], ["ageYears", "4"], ["city", "bengaluru"], ["works", "partly"], ["condition", "worn"], ["goal", "money"]]) {
      const select = (await inCard(page, `return root.querySelector("select[name=${name}]")`)).asElement();
      if (name === "brand") await scrollToHandle(page, select, 90);
      await select.select(value);
      await wait(250);
    }
    await wait(700);
    const submit = (await inCard(page, `return root.querySelector("form button[type=submit]")`)).asElement();
    await clickOn(page, submit);
    paused = true;
    await page.waitForFunction(() => document.getElementById("ecocart-card").shadowRoot.querySelector("input[name=optionId]"), { timeout: 15000 });
    await caption(page, "4", "Routes ordered for your answers, each with what its own page says");
    const tiles = (await inCard(page, `return root.querySelector(".old-phone")`)).asElement();
    await scrollToHandle(page, tiles, 70);
    await wait(2800);
    await slowScroll(page, 520, 3000);
    await wait(600);
    const save = (await inCard(page, `return root.querySelector(".tiles").closest("form").querySelector("button[type=submit]")`)).asElement();
    await clickOn(page, save);
    await page.waitForFunction(() => /Plan saved/.test(document.getElementById("ecocart-card").shadowRoot.textContent), { timeout: 15000 });
    await caption(page, "4", "Saved, with the maker's steps to prepare it");
    const saved = (await inCard(page, `return root.querySelector(".old-phone")`)).asElement();
    await scrollToHandle(page, saved, 60);
    await wait(3000);
  });

  await scene("fridge", async () => {
    await go(page, URLS.whirlpool);
    await ready(page);
    await focusOnCard(page);
    await caption(page, "5", "Appliances: yearly electricity and running cost at your own rate");
    await wait(800);
    const card = (await page.waitForFunction(() => document.getElementById("ecocart-card"), { timeout: 20000 })).asElement();
    await scrollToHandle(page, card, 70);
    await wait(1200);
    const input = (await inCard(page, `return root.querySelector("input[name=tariff]")`)).asElement();
    await clickOn(page, input);
    await input.type("8", { delay: 250 });
    await wait(500);
    const block = (await inCard(page, `return root.querySelector(".tariff")`)).asElement();
    await scrollToHandle(page, block, 60);
    await wait(3500);
  });

  await scene("tea", async () => {
    await go(page, URLS.tea);
    await ready(page);
    await wait(2500);
    const card = (await page.waitForFunction(() => document.getElementById("ecocart-card"), { timeout: 20000 })).asElement();
    // Flipkart scrolls this column inside its own container, not the window.
    await card.evaluate((n) => n.scrollIntoView({ block: "start", behavior: "instant" }));
    await wait(500);
    await focusOnCard(page);
    await caption(page, "6", "Everything else: a category estimate, always labelled");
    await wait(4200);
  });

  await scene("dashboard", async () => {
    paused = true;
    focus = null;
    await page.goto(`chrome-extension://${extensionId}/ui/dashboard.html`, { waitUntil: "domcontentloaded" });
    await wait(2500);
    await caption(page, "7", "Your dashboard: choices, purchases and plans, updated live");
    await wait(2200);
    await slowScroll(page, 700, 2800);
    await wait(1000);
    const tab = await page.$("#tab-actions");
    if (tab) {
      await caption(page, "7", "The plan: reminders, a checklist, and a verified handover once a receipt is seen");
      await clickOn(page, tab);
      await wait(800);
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "smooth" }));
      await wait(1000);
      const planCard = await page.$(".plan");
      if (planCard) await scrollToHandle(page, planCard, 100);
      await wait(3500);
    }
  });

  await scene("end", async () => {
    focus = null;
    await titleCard(page, "Check, choose, act, then see the result.", "Built on AWS Lambda, API Gateway, DynamoDB and Amplify, with Strands agent teams.");
    await wait(3000);
  });

  recording = false;
  await capture;
  fs.writeFileSync(path.join(OUT, "frames.json"), JSON.stringify(frames));
  console.log("frames:", frames.length, "seconds:", frames.length ? (frames[frames.length - 1].t - frames[0].t).toFixed(1) : 0);

  // Off camera: delete the demo plan so the public totals are left as they were.
  try {
    await page.goto(`chrome-extension://${extensionId}/ui/dashboard.html`, { waitUntil: "domcontentloaded" });
    await wait(2500);
    await page.click("#tab-actions").catch(() => {});
    await wait(1200);
    let deleted = 0;
    for (;;) {
      const del = await page.evaluateHandle(() => [...document.querySelectorAll(".plan button")].find((b) => b.textContent === "Delete") || null);
      if (!del.asElement()) break;
      await del.asElement().click();
      deleted += 1;
      await wait(2500);
    }
    console.log("demo plans deleted:", deleted);
  } catch (error) {
    console.log("cleanup failed:", error.message);
  }
  await browser.close();
})();
