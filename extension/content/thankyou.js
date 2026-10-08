// Order confirmation page: if the shopper looked at a device recently, offer the old-device plan.
// Nothing on the order page is read. The device name comes from this browser's own history.

const REMINDER_ID = "ecocart-reminder";
const REMINDER_WINDOW_HOURS = 48;

async function showThankYouReminder() {
  const [latest] = await recentlyViewed();
  if (!latest) return;
  const ageHours = (Date.now() - new Date(latest.viewedAt).getTime()) / 3_600_000;
  if (ageHours > REMINDER_WINDOW_HOURS) return;

  const category = latest.category || "phone";
  const word = DEVICE_WORDS[category];
  const shadow = mountShadow(REMINDER_ID, (host) => document.body.append(host), "styles/card.css");
  const close = el("button", {
    className: "toggle",
    type: "button",
    onClick: () => document.getElementById(REMINDER_ID)?.remove(),
  }, "Close");

  shadow.append(el("section", { className: "card floating", "aria-label": "EcoCart reminder" },
    logoBar(`Got a new ${word}?`, close),
    el("div", { className: "body" },
      renderOldDevice({ modelId: latest.modelId, category }, {
        intro: `If you just bought the ${latest.displayName} you were looking at, plan what happens to your old ${word}.`,
      }),
    ),
  ));
}
