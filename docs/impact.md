# Impact rules

These rules decide what EcoCart counts and how it labels it. The dashboard (`extension/ui/dashboard.js`), the card's choice buttons and the public totals all follow them. The comparison rules are in `extension/ui/impact.js` and tested in `extension/tests/impact.test.js`.

The main rule: **an action is only counted for what it is.** Looking at a product, shortlisting it or saving a plan are not environmental outcomes. Where there is no evidence of an outcome, EcoCart shows a count of actions, never kilograms.

## What is counted

| Figure | When it counts | Labelled as | Where it is kept |
|---|---|---|---|
| Plans waiting for action | The shopper saved an old-device plan | Intention | EcoCart server, anonymous session |
| Handed over, reported by you | The shopper marked the plan done | Your statement | EcoCart server, anonymous session |
| Verified handovers | The EcoCart team has seen a collection receipt or the collector's written confirmation and recorded it with `scripts/verify_handover.py` | Verified | EcoCart server, with a short note of what was seen |
| Footprint difference of your choices | The shopper chose one device over a comparable one (below) | Maker-reported | This browser only |
| Electricity difference | The shopper chose one appliance over a comparable one (below) | Energy label | This browser only |
| Products checked | The shopper opened a product with the card showing | Engagement | This browser only |

The public totals on the website show plans saved, reported done and verified, across all users. They are counters kept on the server when plans change. Nothing else is sent.

## When two products are comparable

**Devices.** Only footprints that one maker reports for its own devices are compared, because makers measure lifecycle carbon in different ways. Both must be the same kind of device (phone with phone), and both figures must be on the same basis. Where a maker reports per storage size, the chosen device must have at least as much storage as the other, so a smaller configuration never looks better just for being smaller. This is the same rule the API uses for its lower-footprint suggestion (`backend/src/compare.py`).

**Appliances.** Only appliances of the same type (the shop's most specific category), of about the same size (capacity, tonnage or screen size stated on both listings, in the same unit and within 10%), and whose listings both state yearly electricity use are compared. A bigger fridge uses more electricity, so a size difference would make the smaller one look better unfairly. BEE labels measure yearly use under a standard test, so the real figure depends on how the appliance is used. The difference is shown in kWh a year, and converted to CO2e with India's grid factor from the Central Electricity Authority.

**Everything else.** A category estimate describes the average for a kind of product at a price. Two products in the same category would differ only by price, so they are never compared, and no choice between them is counted.

## Recording a choice

- A choice has three stages: **considering** (weighing it up), **chosen** (decided on it) and **bought (you said)**. Considering is not counted. Chosen and bought are counted, and bought is shown separately because it is the shopper's own statement.
- The difference is the other product's figure minus the chosen one, never below zero. Choosing the higher-footprint product is recorded but counts nothing.
- Each product takes part in at most one active choice, so one decision is never counted twice. A new choice that involves either product replaces the earlier one.
- Any choice can be undone explicitly. Removing a product from the shortlist preserves recorded decisions and purchase history.
- The difference is between two products' reported figures. It is not a measured saving: it assumes the shopper would otherwise have bought the other product. The dashboard says so wherever the figure is opened.

## The all-time total

The dashboard's Overview opens with the shopper's all-time total: the sum of the differences of every choice that counts (chosen or bought), shown as a running total over time, one step per choice. Hovering a step shows which choice it was.

- It follows the same rules as everything above: only recorded choices between comparable products count, each once, and considering does not count.
- Bought is shown as its own line, and comes only from the shopper: on an order confirmation page EcoCart asks "Did you buy the ... you chose?", without reading the page.
- Appliance differences are kWh a year, which repeats for as long as the appliance runs, so they are shown beside the total and never added to it.
- The total is also given in everyday terms (km by car or scooter, phone charges) using the same sourced factors as the card.
- It lives in the browser with the choices. A backup file keeps it across reinstalls.

## Your purchases

The dashboard also keeps a log of what the shopper says they bought, like a shopping history with a footprint column: two totals, a month-by-month chart for the last twelve months, and a list with the date, product, shop and kg CO₂e.

- A purchase is added only by the shopper: "I bought this" on a product card, or "Did you buy any of these?" on an order confirmation page, which lists products seen in the last two days. EcoCart never reads order or payment pages.
- Each purchase keeps where its number comes from: the maker's own lifecycle report, or a category estimate from the price. Both are labelled in the list, and a product with neither is listed without a number.
- This is the footprint of what was bought. It is a different figure from the difference of choices above, and the two are never added together.
- Makers' reports cover a product's whole life; category estimates cover making that kind of product, from its price. They are different methods, so the dashboard shows two totals and two chart lines and never adds them into one number.
- The same product bought twice on one day counts once. Any purchase can be removed. Confirming a purchase also marks its matching choice as bought; confirming a choice as bought creates the purchase record. Undoing that confirmation removes its linked purchase, and removing the last linked purchase returns the choice to chosen.
- A storage-specific report is counted only when the listing states the matching storage. Unverified regional reports are reference evidence, not that listing's purchase footprint. Saved snapshots retain the report basis and checked date.
- Month filters apply to purchase totals and rows. The history has a Show more control and retains the most recent 500 purchases; backups preserve earlier exports.

## Verifying a handover

A reported handover becomes verified only when the team has seen proof: a collection receipt, or the collector's written confirmation.

1. The shopper marks the plan done, then taps **Ask for verification** on it in the dashboard and types a reference: the collector and a receipt or order number. Only that reference is sent. The plan shows "Requested" until the team decides.
2. The team lists waiting requests with `python scripts/verify_handover.py --pending`, checks each reference with the collector, and records what was seen, without personal details:

```
python scripts/verify_handover.py --action-id <plan ID> --evidence "Cashify pickup receipt seen, 11 Oct 2026"
```

The plan ID is shown on each plan in the dashboard, under My actions. A verified plan cannot be set back to planned by the shopper; a verification recorded by mistake is removed with `--undo`. No collector confirms handovers automatically yet, so this figure starts at zero.

## The plant

The plant grows one stage for each old-device plan the shopper marks done and each lower-footprint choice they record (chosen or bought). Both are the shopper's own reports, and the plant says so under it. Only a verified handover is checked by the team, and the plant is not evidence of one.
