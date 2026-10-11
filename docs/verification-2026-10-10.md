# Verification on 10 October 2026

This log separates API checks, page reading, and what the installed extension actually showed. Results are from extension 0.9.0 unless noted.

## Live services

- The Amplify website and `/privacy.html` returned HTTP 200. The new Use cases and Try EcoCart sections loaded with no script errors, and the page has no horizontal scroll at 390 px wide.
- The deployed API at `https://8el9hdnif0.execute-api.ap-south-1.amazonaws.com` passed all 360 checks in `scripts/smoke_test.py`, including a temporary plan that was created, read, marked done, refused to a second session, and deleted.
- CORS: a preflight from the website's origin is allowed; the API accepts browser calls only from that origin. The extension calls from its service worker, which its host permission allows.
- Live totals: with the website open, a plan saved through the API showed on the page within 15 seconds and the number glowed. The plan was then deleted. `GET /stats` returned `plansSaved 0, plansCompleted 0, plansVerified 0, devicesCovered 170` afterwards. No real-user plan exists yet.
- AWS access with the `ecocart` profile works (account 177106921603). The earlier `InvalidClientTokenId` came from a different local profile.
- Bedrock: every Converse call returns "Operation not allowed". The account is on the AWS Free plan and every Bedrock requests-per-minute quota in ap-south-1 is 0. The card uses its template text, which is labelled "From the sourced facts below". Do not mention Bedrock in the demo until a test call succeeds.

## Extension on current shop pages

All of these ran with the unpacked extension loaded in Edge (`tests/e2e/journey.js` and the checks that preceded it).

| Shop and page | Card | Notes |
| --- | --- | --- |
| [Amazon iPhone 18 Pro](https://www.amazon.in/dp/B0HJB7MQ97) | Phone passport, three steps | Same-maker lower-footprint option (iPhone Air, 55 against 63 kg CO2e, both 256GB, Apple's reports). "I'll choose this instead" recorded the choice and shortlisted both. |
| [Amazon Galaxy A56](https://www.amazon.in/dp/B0DYDPBM8K) | Phone passport, three steps | Old-device plan: form, 3 Bengaluru routes, saved, shown in the popup, marked done, deleted. Switching to the 256 GB variant redrew the card for the new model, with one card on the page. |
| [Flipkart Galaxy A56](https://www.flipkart.com/samsung-galaxy-a56-5g-dark-blue-128-gb/p/itmee04eb4586b5a?pid=MOBHQBE6G85PXAYG) | Phone passport, three steps | Same plan flow passed. |
| [Flipkart Redmi Note 15 Pro](https://www.flipkart.com/redmi-note-15-pro-5g-silver-ash-128-gb/p/itm53c77b92f509c?pid=MOBHK464CQK9FDFM) | Phone passport | Support until at least January 2032 from Xiaomi's list; footprint "Not published by Redmi". |
| [Flipkart Tata Tea 1.5 kg](https://www.flipkart.com/tata-tea-premium-desh-ki-chai-pouch/p/itm01af7253c2b10?pid=TEAFVGGDNMYXFHGE) | Footprint estimate | About 2.6 kg CO2e, tea and coffee, labelled as a category estimate. |
| [Amazon organic T-shirt](https://www.amazon.in/dp/B0BGCMXYPC) | Footprint estimate | GOTS and Fairtrade found in the product description, shown as the seller's claims. |

Earlier today, with the previous build (0.8.3), none of four cards was redrawn in the 25 seconds after loading, and each appeared within 0.6 to 2.2 seconds. The earlier "Plan it" click failure did not reproduce; the automated click-through passes on both shops.

## Dashboard

- The Overview counted the waiting plan, the recorded choice (8 kg CO2e, maker-reported) and three products checked. Every tile opens a panel with what it counts, its evidence level and sources.
- Marking the plan done in the popup moved it from "waiting" to "reported by you" in the open dashboard without a reload.
- Comparisons group the shortlist by kind of evidence: Apple phones together, Samsung phones together, and the tea "kept for later, not compared". The carbon chart no longer puts different makers side by side.

## Automated checks

- Backend: 88 tests passed. Extension: 29 Node tests passed. Agent teams: 19 tests passed. Data validator: passed.
- End to end (`tests/e2e/journey.js`): 13 of 13 checks passed.

## Still to do before the video

1. Ask at least three people outside the team to use it without hints. Record the task, whether they understood the card, where they got stuck, and one quote. No such test is recorded yet.
2. Try one real old-device handover. If it happens and the receipt is seen, record it with `scripts/verify_handover.py` so the Verified stage shows a true example.
3. Get the organisers' written answer on the code written before the event.
4. Make the GitHub repository public and open it signed out.

## Update, 11 October 2026 (extension 0.9.2)

- The card writes CO₂e properly and adds four everyday comparisons, each with its source: km in a petrol hatchback and km on a 110 cc scooter (India GHG Program), full smartphone charges (US EPA's 0.019 kWh per charge times India's CEA grid factor), and kWh of grid electricity (CEA). For the iPhone 16's 56 kg CO₂e: 400 km, 1,500 km, 4,100 charges, 79 kWh.
- New: "Something looks wrong?" on every card, a "Before you hand it over" checklist with the maker's own guide, reminders with a calendar file, "Ask for verification" on reported handovers, backup and restore, duplicate-safe plan saving, and appliance comparisons only at about the same size.
- Backend: 96 tests passed, and the live API passed all 360 smoke checks. Extension: 34 Node tests passed. Agent teams: 19 tests passed.
- End to end with real mouse clicks (`tests/e2e/journey.js`): 18 of 18 checks passed. The test plan was deleted, and the public totals were back at 0 afterwards.

## Update, 11 October 2026 (extension 0.9.4)

- The card now opens with a decision block (what to know, worth checking, what you can do), each fact with its checked date. The iPhone 18 Pro card went from about 2,900 to about 1,100 pixels tall; charts and sources are behind "See the evidence".
- Appliances: EcoCart now reads Amazon's newer details tables and "Kilowatt Hours Per Year". Tested live: with the Whirlpool 235 L (192 kWh a year) on the shortlist, the Haier 237 L card (230 kWh) says the Whirlpool uses 38 kWh a year less. A 330 L fridge was correctly not compared.
- The dashboard separates reported purchases from the possible difference of choices not reported as bought, puts the next step at the top, guides a first visit, and plans for an old device without a new purchase (tested: "Old Samsung phone, 3 years. Not replacing it.", then deleted).
- Website: the shopper questions follow the opening section, and a demonstration lets visitors choose between two real phones (live API) or two fridges (listings saved today), watch a sample dashboard update and undo it. Nothing in the demonstration is saved. No script errors; no horizontal scroll at 390 px.
- End to end with real clicks: 20 of 20 checks passed; public totals back at 0 afterwards.

## Coverage, 11 October 2026 (extension 0.9.6)

- 100 live products, the first result for 50 everyday searches on each shop: every one got a card. Before this release 83 showed a labelled category estimate, 2 showed the maker's own device facts and 15 were devices with no number at all.
- Fixes: devices whose maker publishes nothing now also get the labelled category estimate for their kind of product; new Open CEDA sectors for refrigerators, laundry, other large appliances, air conditioners, computers and phones, plus TVs and smartwatches; large appliances no longer fall into "Other household goods". A per-cycle energy figure is no longer read as yearly. Re-testing the 16 device pages from that run: all 16 now show a labelled estimate.
- Amazon.in's Best Sellers tree (3,185 category paths, three levels): 2,981 were matched by a rule before these changes, though some only through the broad "Home & Kitchen" rule. The 187 specific paths still unmatched are being drafted into rules by the category team on a local model, for a person to approve.
