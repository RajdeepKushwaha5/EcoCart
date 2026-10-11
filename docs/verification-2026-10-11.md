# Verification on 11 October 2026

This log records release checks and the source quotes behind the route details.

## Release 0.9.10: audit fixes and deployment

The release fixes linked purchase confirmation and undo, preserves decision history when the shortlist is cleared, checks report applicability, separates incompatible chart groups, and excludes zero-improvement choices from plant growth. Search badges retry temporary failures, purchase history supports pagination and monthly totals, and malformed backups are rejected before storage changes. Appliance payback now states that it uses saved prices.

Plan saves use deterministic request IDs and conditional writes. Conflicting updates and deletes are rejected. Server-side route validation enforces device restrictions. Search batches use rules only, so optional model classification cannot create a model call for every result. The first concurrent live check exposed a DynamoDB Decimal serialization error in a replayed response; that was fixed and given a regression test before the final deployment.

Validation performed on 11 October:

- Backend: 109 tests passed.
- Extension: 52 tests passed.
- Research tooling: 19 tests passed.
- Final deployed API smoke test: 360 passed, 0 failed.
- Full live Amazon.in and Flipkart browser journey passed with no script errors, including purchase confirmation/undo, 20-row pagination, filtered monthly totals, and rejection of an invalid backup without overwriting records.
- Five concurrent saves against the deployed API produced one plan. Concurrent edits completed or returned a conflict. The same test passed against the local API. Temporary plans were deleted.
- Data validation, SAM lint and JavaScript syntax checks passed.
- All three README Mermaid diagrams parsed and rendered in a browser. README local links resolved.
- SAM deployment completed successfully in ap-south-1. Amplify deployment succeeded.
- The public extension download reports 0.9.10; every packaged application file matches the local release.
- The deployed API Lambda's Python and JSON source files match the local backend. Lambda reports Active and Successful.

These are software checks. No outside-user study, confirmed real-world handover, or measured environmental saving is implied. Bedrock remains disabled in the deployed stack.

## Earlier 0.9.8 checks

## Search results

With the unpacked extension in Edge, on live search pages:

| Search | Badges | Notes |
| --- | --- | --- |
| Amazon "tata tea premium" | 38 to 40 estimate badges | Tea and coffee, about 1.3 to 2.5 kg CO₂e each, from each result's price. |
| Amazon "samsung galaxy phone" | 10 estimates, 3 to 4 device badges | Every estimate is "mobile phones". Before today's fix, titles such as "Galaxy M36 5G Mobile ... 50MP Triple Camera ... Without Charger" were classed as cameras or chargers. |
| Flipkart "cotton shirt men" | 40 estimate badges | Clothing. Grid tiles had no title before today's fix (empty image alt text). |
| Flipkart "green tea" | 40 estimate badges | Tea and coffee. |

- Each badge reads "EcoCart estimate ≈ X kg CO₂e"; its tooltip says it is the average for that kind of product at that price, not a measurement of the product.
- `POST /estimates` with 60 titles took 15 s and timed out before today's fix (the title patterns were recompiled on every call); it now takes 0.6 to 1.2 s.
- No result was badged twice (`tests/e2e/journey.js`).

## Route details

Each route now states how the handover works, what it costs, what you get, whether broken devices are taken, and where it runs. A field is `null` (shown as "Not stated on its page") when the route's page does not say. Quotes from the pages, read on 11 October 2026:

**Apple Trade In** ([apple.com/in/trade-in](https://www.apple.com/in/trade-in/))
- "Exchange online or at an Apple Store. We'll give you instant credit toward a purchase, lowering your order total."
- "Mac, iPad and Apple Watch trade-in is available only in-store in India."
- "If your device isn't eligible for credit, we'll recycle it ... securely and for free."

**Samsung Care for Clean India** ([samsung.com/in/microsite/care-for-clean-india](https://www.samsung.com/in/microsite/care-for-clean-india/))
- "Simply WhatsApp us at 1800 5 7267864. No fee is charged from the consumer for giving the e-waste for recycling."
- "All the products sold by Samsung in Indian market are accepted. This includes Mobile Phones, Tablets, Television, Computer Monitors, Laptops, Washing Machines, Air Conditioner, Refrigerators, Microwave, Dishwashers etc."
- "There is no monetary benefit/discount linked to this program."
- Changed: the earlier text said to drop phones in an e-waste bin at a service centre. Neither Samsung page says that today, so it was removed.

**Cashify: sell your used phone** ([cashify.in/sell-old-mobile-phone](https://www.cashify.in/sell-old-mobile-phone))
- "No fees for pickup across 1500 cities across India"
- "Instant Money Transfer in your preferred mode at time of pick up or store drop off"
- "Cashify accepts non-working phones as well", which "might get a lower price".

**Cashify: sell your used laptop** ([cashify.in/sell-old-laptop](https://www.cashify.in/sell-old-laptop))
- "No fees for pickup across 1500 cities across India"; paid "as soon as our executive picks up your device". The page does not say whether broken laptops are taken.

**Cashify: recycle your phone** ([cashify.in/recycle-old-phone](https://www.cashify.in/recycle-old-phone))
- "We'll then assign a date & time for the pickup from your address." The page does not say whether recycling costs anything, whether you are paid, or whether phones that don't work are taken.
- Changed: "including ones that no longer work" was removed from what it accepts, because the page no longer says it.

The Cashify tablet, TV, refrigerator and console routes keep their 30 September and 2 October checks ("book a free pickup", "get paid when it is collected"). The pages were not re-read today, so their broken-device and area fields are `null`.

None of these routes has a confirmed handover with EcoCart. The card and dashboard say "A contact link, not a booking".

## Old-device check

The plan form asks three questions: does it work, its condition, and what the owner wants (money or credit, someone keeps using it, recycle it safely). The answers only order the checked routes and explain why, using each route's own stated facts; every route stays visible. A route that does not say whether it takes broken devices is placed lower for a device that doesn't work, and says so. For a device that partly works or is damaged, the card suggests asking for a repair quote first, and for a damaged one it warns not to charge or post a swollen battery. The answers are stored with the plan.
