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
