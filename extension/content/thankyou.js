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

// "Did you buy any of these?" for products looked at in the last two days. Yes adds one to the purchase log.
function recentPurchaseQuestion(products) {
  const section = el("div", { className: "old-phone" });
  const row = (product) => {
    const line = el("div", { className: "bought-row" },
      el("div", {},
        el("p", { className: "decide-text" }, el("strong", {}, product.name.slice(0, 80))),
        el("p", { className: "meta" }, product.kg != null
          ? `About ${formatNumber(product.kg)} kg CO₂e, ${product.basis === "reported" ? "as its maker reports" : "a category estimate"}`
          : "No footprint figure for it")));
    line.append(button("Yes, I bought it", async () => {
      await logPurchase(product);
      show(line, el("p", { className: "shortlist-state" }, el("span", { className: "tick", "aria-hidden": "true" }), `Added: ${product.name.slice(0, 50)}`));
    }, "ghost small"));
    return line;
  };
  show(section,
    el("p", { className: "eyebrow accent" }, "Your purchases"),
    el("p", { className: "section-title" }, "Did you buy any of these?"),
    el("p", { className: "muted" }, "EcoCart does not read this page. Tell it what you bought, and your dashboard adds it to your purchases."),
    products.map(row),
    dashboardLink("See your purchases"));
  return section;
}

async function showThankYouReminder() {
  const choice = await recentUnboughtChoice();
  const [latest] = await recentlyViewed();
  const recentView = latest && (Date.now() - new Date(latest.viewedAt).getTime()) / 3_600_000 <= REMINDER_WINDOW_HOURS;
  const cutoff = Date.now() - REMINDER_WINDOW_HOURS * 3_600_000;
  const recentProducts = [];
  for (const product of await loadRecentProducts()) {
    if (new Date(product.seenAt).getTime() < cutoff || recentProducts.length >= 3) continue;
    if (!(await hasPurchasedToday(product.key))) recentProducts.push(product);
  }
  if (!choice && !recentView && recentProducts.length === 0) return;

  const category = latest?.category || "phone";
  const word = DEVICE_WORDS[category];
  const shadow = mountShadow(REMINDER_ID, (host) => document.body.append(host), "styles/card.css");
  const close = el("button", {
    className: "toggle",
    type: "button",
    onClick: () => document.getElementById(REMINDER_ID)?.remove(),
  }, "Close");

  shadow.append(el("section", { className: "card floating", "aria-label": "EcoCart reminder" },
    logoBar(recentView ? `Got a new ${word}?` : "Your order", close),
    el("div", { className: "body" },
      choice ? purchaseQuestion(choice) : null,
      recentProducts.length ? recentPurchaseQuestion(recentProducts) : null,
      recentView
        ? renderOldDevice({ modelId: latest.modelId, category }, {
          intro: `If you just bought the ${latest.displayName} you were looking at, plan what happens to your old ${word}.`,
        })
        : null,
    ),
  ));
}
