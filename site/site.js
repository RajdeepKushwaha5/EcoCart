// Page behaviour: navigation, the hero word, canvases, live totals and scroll reveals.
// config.js (written at deploy) sets window.ECOCART_API. plant.js provides plantSvg and PLANT_STAGES.

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------- Navigation ----------

function setUpNav() {
  const nav = document.getElementById("nav");
  const toggle = document.getElementById("nav-toggle");
  const menu = document.getElementById("mobile-menu");
  const update = () => nav.classList.toggle("scrolled", window.scrollY > 20);
  update();
  window.addEventListener("scroll", update, { passive: true });

  const setOpen = (open) => {
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    document.body.style.overflow = open ? "hidden" : "";
  };
  toggle.addEventListener("click", () => setOpen(menu.hidden));
  menu.addEventListener("click", (event) => {
    if (event.target.closest("a")) setOpen(false);
  });
}

// ---------- Hero word: letters blur in, briefly in the gradient colours ----------

const HERO_WORDS = ["last", "matter", "count", "add up"];
const GRADIENT = ["#eca8d6", "#a78bfa", "#67e8f9", "#fbbf24", "#eca8d6"];

function gradientAt(position) {
  const scaled = position * (GRADIENT.length - 1);
  const lower = Math.floor(scaled);
  const upper = Math.min(lower + 1, GRADIENT.length - 1);
  const mix = scaled - lower;
  const channels = (hex) => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
  const [a, b] = [channels(GRADIENT[lower]), channels(GRADIENT[upper])];
  return `rgb(${a.map((value, i) => Math.round(value + (b[i] - value) * mix)).join(",")})`;
}

function showWord(target, word) {
  target.replaceChildren();
  const letters = [...word];
  const spans = letters.map((char, i) => {
    const span = document.createElement("span");
    span.className = "ch";
    span.textContent = char === " " ? " " : char;
    span.style.color = gradientAt(i / Math.max(letters.length - 1, 1));
    target.append(span);
    return span;
  });
  if (reduceMotion) {
    spans.forEach((span) => { span.style.color = "#fff"; });
    return;
  }
  spans.forEach((span, i) => {
    span.animate(
      [{ opacity: 0, filter: "blur(20px)" }, { opacity: 1, filter: "blur(0px)" }],
      { duration: 500, delay: i * 45, easing: "cubic-bezier(0.22, 1, 0.36, 1)", fill: "both" },
    );
  });
  setTimeout(() => spans.forEach((span) => { span.style.color = "#fff"; }), 45 * letters.length + 700);
}

function cycleHeroWord() {
  const target = document.getElementById("blur-word");
  let index = 0;
  showWord(target, HERO_WORDS[index]);
  if (reduceMotion) return;
  setInterval(() => {
    index = (index + 1) % HERO_WORDS.length;
    showWord(target, HERO_WORDS[index]);
  }, 2500);
}

// ---------- Hero video ----------

// The glowing tree. It stays on its first frame for visitors who ask for less motion.
function heroVideo() {
  const video = document.getElementById("hero-video");
  if (reduceMotion) {
    video.removeAttribute("autoplay");
    video.pause();
    return;
  }
  video.play().catch(() => {
    // Autoplay can be blocked; the poster image stays.
  });
}

// ---------- Canvases ----------

// Runs a draw function every frame while the canvas is on screen, at the right pixel density.
function animateCanvas(canvas, draw) {
  const ctx = canvas.getContext("2d");
  let width = 0;
  let height = 0;
  let visible = false;
  let frame = 0;
  let time = Math.random() * 100;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width;
    height = rect.height;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  };
  const tick = () => {
    ctx.clearRect(0, 0, width, height);
    draw(ctx, width, height, time);
    time += 0.016;
    if (visible && !reduceMotion) frame = requestAnimationFrame(tick);
  };
  new ResizeObserver(() => { resize(); if (!visible || reduceMotion) tick(); }).observe(canvas);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    cancelAnimationFrame(frame);
    if (visible) tick();
  }).observe(canvas);
}

// Drifting points that gather around the mouse, as in the reference's feature card.
function particleField(canvas, count, alphaScale = 1) {
  const mouse = { x: 0.5, y: 0.5 };
  canvas.parentElement.addEventListener("mousemove", (event) => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = (event.clientX - rect.left) / rect.width;
    mouse.y = (event.clientY - rect.top) / rect.height;
  });
  const points = Array.from({ length: count }, (_, i) => {
    const seed = i * 1.618;
    return { bx: (seed * 127.1) % 1, by: (seed * 311.7) % 1, phase: seed * Math.PI * 2, speed: 0.4 + (seed % 0.4), radius: 1.2 + (seed % 2.2) };
  });
  animateCanvas(canvas, (ctx, w, h, t) => {
    for (const p of points) {
      const distance = Math.hypot(p.bx - mouse.x, p.by - mouse.y);
      const pull = Math.max(0, 1 - distance * 2.8);
      const x = p.bx * w + Math.sin(t * p.speed * 0.4 + p.phase) * 38 + pull * Math.cos(t + p.phase) * 36;
      const y = p.by * h + Math.cos(t * p.speed * 0.3 + p.phase * 0.7) * 24 + pull * Math.sin(t + p.phase) * 36;
      const pulse = Math.sin(t * p.speed + p.phase) * 0.5 + 0.5;
      ctx.beginPath();
      ctx.arc(x, y, p.radius + pulse * 0.8, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${(0.08 + pulse * 0.18 + pull * 0.3) * alphaScale})`;
      ctx.fill();
    }
  });
}

// A breathing grid of dots with a slow scan line, behind the live totals.
function dotGrid(canvas) {
  animateCanvas(canvas, (ctx, w, h, t) => {
    for (let x = 0; x < w; x += 60) {
      for (let y = 0; y < h; y += 60) {
        const wave = Math.sin(x * 0.01 + y * 0.01 + t * 1.25) * 0.5 + 0.5;
        ctx.beginPath();
        ctx.arc(x, y, 1 + wave * 2, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255, 255, 255, 0.04)";
        ctx.fill();
      }
    }
    const scan = (t * 37) % h;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.03)";
    ctx.beginPath();
    ctx.moveTo(0, scan);
    ctx.lineTo(w, scan);
    ctx.stroke();
  });
}

// A row of dots rising and falling, as in the reference's metric cards.
function dotGraph(canvas, colour) {
  const f1 = 0.2 + Math.random() * 0.25;
  const f2 = 0.07 + Math.random() * 0.1;
  animateCanvas(canvas, (ctx, w, h, t) => {
    for (let i = 0; i < Math.floor(w / 8); i += 1) {
      const value = Math.max(0, Math.min(1, 0.35 + 0.5 * Math.sin(i * f1 + t * 1.4) * Math.cos(i * f2 + t * 0.7)));
      const alpha = 0.15 + value * 0.55;
      ctx.beginPath();
      ctx.arc(i * 8 + 4, h - 4 - value * (h - 8), 1.5 + value * 1.2, 0, Math.PI * 2);
      ctx.fillStyle = colour === "pink" ? `rgba(236, 168, 214, ${alpha})` : `rgba(255, 255, 255, ${alpha})`;
      ctx.fill();
    }
  });
}

// Soft green wave lines along the top of the footer.
function waves(canvas) {
  animateCanvas(canvas, (ctx, w, h, t) => {
    ctx.strokeStyle = "rgba(100, 200, 150, 0.3)";
    ctx.lineWidth = 1;
    for (let wave = 0; wave < 3; wave += 1) {
      ctx.beginPath();
      for (let x = 0; x <= w; x += 5) {
        const y = h * 0.5 + Math.sin(x * 0.01 + t * 1.25 + wave * 0.5) * 30 + Math.sin(x * 0.02 + t * 1.9 + wave) * 20;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
}

// ---------- Numbers ----------

function countTo(node, end, decimals = 0) {
  if (reduceMotion) {
    node.textContent = end.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const progress = Math.min((now - start) / 2500, 1);
    const eased = 1 - (1 - progress) ** 4;
    node.textContent = (eased * end).toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    node.style.filter = progress < 0.8 ? "blur(1px)" : "";
    if (progress < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function whenVisible(node, callback) {
  new IntersectionObserver((entries, observer) => {
    if (entries[0].isIntersecting) {
      observer.disconnect();
      callback();
    }
  }, { threshold: 0.4 }).observe(node);
}

async function loadTotals() {
  let stats;
  try {
    const response = await fetch(`${window.ECOCART_API}/stats`);
    if (!response.ok) throw new Error(`status ${response.status}`);
    stats = await response.json();
  } catch {
    // Keep the zeros rather than showing made-up numbers.
    return;
  }
  countTo(document.getElementById("stat-saved"), stats.plansSaved);
  countTo(document.getElementById("stat-devices"), stats.devicesCovered);
  document.getElementById("devices-stat").textContent = stats.devicesCovered;
  for (const node of document.querySelectorAll("[data-live]")) {
    whenVisible(node, () => countTo(node, stats[node.dataset.live] ?? 0));
  }
}

function factCounters() {
  for (const node of document.querySelectorAll("[data-count]")) {
    whenVisible(node, () => countTo(node, Number(node.dataset.count), Number(node.dataset.decimals || 0)));
  }
}

function startClock() {
  const clock = document.getElementById("clock");
  const tick = () => {
    clock.textContent = `${new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata" })} IST`;
  };
  tick();
  setInterval(tick, 1000);
}

// ---------- Process steps ----------

function setUpSteps() {
  const steps = [...document.querySelectorAll(".step")];
  let active = 0;
  let timer = null;
  const select = (index) => {
    active = index;
    steps.forEach((step, i) => {
      step.classList.toggle("active", i === index);
      step.setAttribute("aria-selected", String(i === index));
      // Restart the progress line.
      const line = step.querySelector(".step-line i");
      line.style.animation = "none";
      void line.offsetWidth;
      line.style.animation = "";
    });
  };
  const restart = () => {
    clearInterval(timer);
    if (!reduceMotion) timer = setInterval(() => select((active + 1) % steps.length), 6000);
  };
  steps.forEach((step, i) => step.addEventListener("click", () => { select(i); restart(); }));
  restart();
}

// ---------- Plant stages ----------

function drawStages() {
  const holder = document.getElementById("stages");
  PLANT_STAGES.forEach((name, stage) => {
    const item = document.createElement("div");
    item.className = "stage reveal";
    item.style.transitionDelay = `${stage * 80}ms`;
    item.innerHTML = plantSvg(stage); // Fixed shapes only.
    const number = document.createElement("p");
    number.className = "stage-num";
    number.textContent = String(stage + 1).padStart(2, "0");
    const label = document.createElement("p");
    label.className = "stage-name";
    label.textContent = name;
    item.append(number, label);
    holder.append(item);
  });
}

// ---------- Call to action spotlight ----------

function ctaSpotlight() {
  const box = document.getElementById("cta-box");
  box.addEventListener("mousemove", (event) => {
    const rect = box.getBoundingClientRect();
    box.style.setProperty("--x", `${((event.clientX - rect.left) / rect.width) * 100}%`);
    box.style.setProperty("--y", `${((event.clientY - rect.top) / rect.height) * 100}%`);
  });
}

// ---------- Scroll-linked art ----------

// The hands move together as their section scrolls in, touching when they reach the middle of the screen.
// The meadow above the footer drifts a little slower than the page.
function scrollArt() {
  const hands = document.querySelector(".hands");
  const meadow = document.querySelector(".meadow");
  if (reduceMotion) return;
  const clamp = (value) => Math.min(Math.max(value, 0), 1);
  let pending = false;
  const update = () => {
    pending = false;
    const height = window.innerHeight;
    const handsBox = hands.getBoundingClientRect();
    const start = height;
    const end = height * 0.55 - handsBox.height / 2;
    const progress = clamp((start - handsBox.top) / (start - end));
    hands.style.setProperty("--p", (1 - (1 - progress) ** 3).toFixed(3));
    const meadowBox = meadow.getBoundingClientRect();
    meadow.style.setProperty("--m", clamp((height - meadowBox.top) / (height + meadowBox.height)).toFixed(3));
  };
  const request = () => {
    if (!pending) {
      pending = true;
      requestAnimationFrame(update);
    }
  };
  window.addEventListener("scroll", request, { passive: true });
  window.addEventListener("resize", request);
  update();
}

// ---------- Scroll reveals ----------

function reveals() {
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting) {
        entry.target.classList.add("in");
        observer.unobserve(entry.target);
      }
    }
  }, { threshold: 0.12 });
  document.querySelectorAll(".reveal").forEach((node) => observer.observe(node));
}

setUpNav();
cycleHeroWord();
heroVideo();
particleField(document.getElementById("particles"), 70);
dotGrid(document.getElementById("metric-grid"));
document.querySelectorAll("canvas[data-dots]").forEach((canvas) => dotGraph(canvas, canvas.dataset.dots));
waves(document.getElementById("waves"));
drawStages();
scrollArt();
reveals();
setUpSteps();
startClock();
factCounters();
ctaSpotlight();
loadTotals();
