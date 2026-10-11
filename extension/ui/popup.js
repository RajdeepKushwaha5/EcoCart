import { actionCard, celebrate, loadActions, node, pad, PLANS_CHANGED_KEY, renderPlant } from "./shared.js";

const POPUP_LIMIT = 3;

const plant = document.getElementById("plant");
const savedCount = document.getElementById("saved-count");
const doneCount = document.getElementById("done-count");
const statusLine = document.getElementById("status");
const list = document.getElementById("list");

const showError = (message) => {
  statusLine.textContent = message;
};

async function load({ completed = false } = {}) {
  statusLine.textContent = "";
  let actions;
  try {
    actions = await loadActions();
  } catch {
    showError("Couldn't load your plans. Check your connection.");
    renderPlant(plant, 0);
    return;
  }

  const done = actions.filter((action) => action.status === "done").length;
  savedCount.textContent = pad(actions.length);
  doneCount.textContent = pad(done);
  const grown = greenActions(actions, await loadChoices());
  renderPlant(plant, grown);
  if (completed) celebrate(grown);

  if (actions.length === 0) {
    const empty = node("div", "empty");
    empty.append(
      node("p", "empty-title", "No plans yet"),
      node("p", "", "Open any device on Amazon.in or Flipkart and plan what happens to your old one."),
    );
    list.replaceChildren(empty);
    return;
  }

  const open = actions.filter((action) => action.status === "planned");
  const shown = (open.length > 0 ? open : actions).slice(0, POPUP_LIMIT);
  list.replaceChildren(...shown.map((action) => actionCard(action, load, showError)));
}

// The all-time footprint difference of the shopper's recorded choices. impact.js is loaded first as a plain script.
async function loadAllTime() {
  const { totals } = impactTimeline(await loadChoices());
  const line = document.getElementById("alltime");
  if (!totals.deviceKg) {
    line.replaceChildren();
    return;
  }
  line.replaceChildren(node("strong", "", `${totals.deviceKg.toLocaleString("en-IN", { maximumFractionDigits: 1 })} kg CO₂e`),
    ` lower footprint from your choices, all time`);
}

// A plan saved or changed on a shop page shows up here at once, and so does a new choice.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") return;
  if (changes[PLANS_CHANGED_KEY]) load();
  if (changes[CHOICES_KEY]) { load(); loadAllTime(); }
});

load();
loadAllTime();
