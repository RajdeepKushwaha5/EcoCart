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
- Any choice can be undone, and removing a product from the shortlist removes the choices it was part of.
- The difference is between two products' reported figures. It is not a measured saving: it assumes the shopper would otherwise have bought the other product. The dashboard says so wherever the figure is opened.

## Verifying a handover

A reported handover becomes verified only when the team has seen proof: a collection receipt, or the collector's written confirmation.

1. The shopper marks the plan done, then taps **Ask for verification** on it in the dashboard and types a reference: the collector and a receipt or order number. Only that reference is sent. The plan shows "Requested" until the team decides.
2. The team lists waiting requests with `python scripts/verify_handover.py --pending`, checks each reference with the collector, and records what was seen, without personal details:

```
python scripts/verify_handover.py --action-id <plan ID> --evidence "Cashify pickup receipt seen, 11 Oct 2026"
```

The plan ID is shown on each plan in the dashboard, under My actions. A verified plan cannot be set back to planned by the shopper; a verification recorded by mistake is removed with `--undo`. No collector confirms handovers automatically yet, so this figure starts at zero.
