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
  renderPlant(plant, done);
  if (completed) celebrate(done);

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

// A plan saved or changed on a shop page shows up here at once.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[PLANS_CHANGED_KEY]) load();
});

load();
