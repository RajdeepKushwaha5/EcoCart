// Shared by the popup and the dashboard. plant.js is loaded first as a plain script,
// so plantStage and plantSvg are globals here.

export async function api(method, path, body) {
  const response = await chrome.runtime.sendMessage({ type: "api", method, path, body, auth: true });
  if (!response?.ok) throw new Error(response?.error || "No response from EcoCart");
  return response.data;
}

export function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

export function button(label, onClick, variant) {
  const element = node("button", `btn ${variant}`, label);
  element.type = "button";
  element.addEventListener("click", onClick);
  return element;
}

export function pad(number) {
  return String(number).padStart(2, "0");
}

export function formatDay(isoText) {
  return new Date(isoText).toLocaleDateString("en-IN", { dateStyle: "medium" });
}

const DEVICE_WORDS = {
  phone: "phone", laptop: "laptop", tablet: "tablet", watch: "watch", earbuds: "earbuds",
  tv: "TV", appliance: "appliance", electronics: "device",
};

// Plans saved by earlier versions use "oldPhone" and have no category.
function planSummary(action) {
  const old = action.oldDevice || action.oldPhone;
  const word = DEVICE_WORDS[action.category] || "phone";
  return `Old ${old.brand} ${word}, ${old.ageYears} years. Replacing with ${action.modelName}.`;
}

export async function loadActions() {
  const { actions } = await api("GET", "/actions");
  return actions.sort((a, b) => b.actionId.localeCompare(a.actionId));
}

function plantArt(stage, className = "plant-art") {
  const art = node("div", className);
  art.innerHTML = plantSvg(stage); // Built from fixed shapes only, no user data.
  return art;
}

export function renderPlant(container, completed) {
  const { stage, name, next } = plantStage(completed);
  container.replaceChildren(plantArt(stage), node("p", "plant-name", name), node("p", "plant-next", next));
}

// Full-screen moment shown after a plan is marked done.
export function celebrate(completed) {
  const { stage, name, next } = plantStage(completed);
  const overlay = node("div", "celebrate");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "Plan completed");

  const close = () => overlay.remove();
  const panel = node("div", "celebrate-panel");
  panel.append(
    plantArt(stage, "plant-art growing"),
    node("p", "celebrate-title", "Your plant grew"),
    node("p", "celebrate-stage", name),
    node("p", "muted", `Your old device is out of the drawer and on its way to a second life. ${next}.`),
    button("Nice", close, "primary"),
  );
  overlay.append(panel);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  document.body.append(overlay);
  panel.querySelector("button").focus();
}

// One saved plan with its controls. onChange runs after a successful update and
// receives { completed: true } when the plan was just marked done.
export function actionCard(action, onChange, onError) {
  const item = node("article", `action ${action.status}`);

  const head = node("div", "action-head");
  head.append(
    node("span", "action-title", action.optionName),
    node("span", `pill ${action.status}`, action.status === "done" ? "Done" : "Planned"),
  );

  const change = async (method, body) => {
    try {
      await api(method, `/actions/${encodeURIComponent(action.actionId)}`, body);
      await onChange({ completed: body?.status === "done" });
    } catch {
      onError("Couldn't update that plan. Please try again.");
    }
  };

  const controls = node("div", "controls");
  if (action.status === "planned") {
    controls.append(button("Mark done", () => change("PATCH", { status: "done" }), "primary"));
  } else {
    controls.append(button("Undo", () => change("PATCH", { status: "planned" }), "ghost"));
  }
  controls.append(button("Delete", () => change("DELETE"), "ghost"));

  const when = action.status === "done" && action.doneAt
    ? `Done ${formatDay(action.doneAt)}`
    : `Saved ${formatDay(action.createdAt)}`;
  item.append(
    head,
    node("p", "", planSummary(action)),
    node("p", "meta", when),
    controls,
  );
  return item;
}
