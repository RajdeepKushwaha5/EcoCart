// Order confirmation page: ask whether the shopper bought the lower-footprint product they chose, and if they looked
// at a device recently, offer the old-device plan. Nothing on the order page is read: the product names come from
// this browser's own records, and the shopper answers.

const REMINDER_ID = "ecocart-reminder";
const REMINDER_WINDOW_HOURS = 48;

// "Did you buy it?" for the most recent choice not yet marked as bought. Yes moves it to "Bought (you said)".
function purchaseQuestion(choice) {
  const section = el("div", { className: "old-phone" });
  const answered = (text) => show(section, el("p", { className: "section-title" }, text),
    dashboardLink("See your all-time total"));
  show(section,
    el("p", { className: "eyebrow accent" }, "Your choice"),
    el("p", { className: "section-title" }, `Did you buy the ${choice.chosen.name}?`),
    el("p", { className: "muted" },
      `You chose it over the ${choice.instead.name}. If this order is for it, your dashboard counts it as bought, as you said.`),
    el("div", { className: "row" },
      button("Yes, I bought it", async () => {
        await setChoiceStage(choice.id, "purchased");
        answered("Counted as bought. Thank you.");
      }),
      button("No", () => answered("No problem. It stays as chosen."), "ghost")));
  return section;
}

async function showThankYouReminder() {
  const choice = await recentUnboughtChoice();
  const [latest] = await recentlyViewed();
  const recentView = latest && (Date.now() - new Date(latest.viewedAt).getTime()) / 3_600_000 <= REMINDER_WINDOW_HOURS;
  if (!choice && !recentView) return;

  const category = latest?.category || "phone";
  const word = DEVICE_WORDS[category];
  const shadow = mountShadow(REMINDER_ID, (host) => document.body.append(host), "styles/card.css");
  const close = el("button", {
    className: "toggle",
    type: "button",
    onClick: () => document.getElementById(REMINDER_ID)?.remove(),
  }, "Close");

  shadow.append(el("section", { className: "card floating", "aria-label": "EcoCart reminder" },
    logoBar(recentView ? `Got a new ${word}?` : "Your choice", close),
    el("div", { className: "body" },
      choice ? purchaseQuestion(choice) : null,
      recentView
        ? renderOldDevice({ modelId: latest.modelId, category }, {
          intro: `If you just bought the ${latest.displayName} you were looking at, plan what happens to your old ${word}.`,
        })
        : null,
    ),
  ));
}
