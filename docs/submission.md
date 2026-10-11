# EcoCart submission draft

This is a working draft. Check every link and record the video before submitting. Do not claim that the repository was started during the event based only on its first commit date. The September prototype is documented in `D:\EcoCart\blog.md`; ask the organizers how the new-project rule applies before submitting this code.

## Short writeup

When someone shops for a replacement device, the old device is easy to forget. EcoCart puts an evidence card on Amazon.in and Flipkart product pages at that moment. For catalogued devices it shows the maker's published update support and lifecycle footprint when available. For other physical products it shows a clearly labelled category average derived from Open CEDA, never a measured footprint for that exact item. A shopper replacing a device can choose an exchange, reuse, or recycling route and save a plan. When a same-maker device with a lower reported footprint is offered at a similar price, the shopper can choose it, and the choice is recorded. The dashboard keeps saved, reported-done and verified handovers apart, counts a footprint difference only for a recorded choice between comparable products, and never turns a product view or a saved plan into kilograms. Every number opens to show its source and evidence level.

The Chrome extension reads the visible listing and calls an API deployed with AWS SAM: API Gateway routes requests to Python Lambda functions, which use DynamoDB for the catalog, options, anonymous sessions, and saved plans. The public site is hosted on AWS Amplify. Bedrock is optional and should only be mentioned in the submitted demo if it is enabled and shown working; as of 10 October the account's Bedrock quotas are 0. Model output cannot create a carbon number. Facts and factors link to their sources, and missing facts remain unknown.

Code and documentation were assisted by Claude Code and OpenAI Codex. The idea was informed by the 2023 EcoCart project; no code or assets from it were reused. Open CEDA data is credited under CC BY-SA 4.0, and the fonts are under the SIL Open Font License. See the README and `docs/method.md` for details.

## Three-minute video shot list

| Time | Show on screen | Say |
| --- | --- | --- |
| 0:00-0:15 | A real old phone, and the iPhone 18 Pro page on Amazon.in | "Buying a new phone is the moment to decide two things: which one, and where the old one goes." |
| 0:15-0:50 | The card's three steps on the iPhone 18 Pro. Open a source. Tap "I'll choose this instead" on the iPhone Air. | "What we know comes from Apple's own pages. What it means: Apple reports 55 kg for the Air against 63 for this one. Only one maker is compared, because makers measure differently." |
| 0:50-1:15 | Tata Tea on Flipkart, then the organic T-shirt | "Everything else gets a category estimate, labelled as one every time, and the labels the listing claims, marked as the seller's claims." |
| 1:15-1:45 | Galaxy A56: Plan it, pick a Bengaluru route, save. Open the dashboard. | "The useful action is planning where the old phone goes. The dashboard shows it waiting, with the next step on top." |
| 1:45-2:10 | Mark it done in the popup while the dashboard is open; the tile changes and glows. Tap a tile to open its evidence panel. | "Reported by you is not verified. A handover is verified only when the team has seen a receipt. Views are never turned into kilograms." |
| 2:10-2:35 | The website: Try EcoCart answering live, then the live totals | "Judges can try it without installing. Every answer comes live from the API." |
| 2:35-2:50 | AWS console: API Gateway, Lambda, DynamoDB, the scheduled jobs and alarms, Amplify | "API Gateway and Lambda serve the card, DynamoDB holds the catalog and plans, two scheduled jobs keep prices and support dates fresh, and Amplify hosts the site." |
| 2:50-3:00 | One observed user-test result | State the actual result and one limitation. Do not invent a user or impact number. |

Record a real screen capture. Keep the uploaded YouTube video under three minutes and check it in a signed-out browser.

## Before submitting

- [ ] Get a written answer from the organizers on the documented pre-event prototype. Keep the answer with the project records.
- [ ] Check each teammate's registration, check-in, and AWS Builder Center profile.
- [ ] Run the extension on current Amazon.in and Flipkart pages in a normal Chrome profile. Record tested URLs, visible prices, card states, and failures in `docs/live-coverage.md` or a dated test log.
- [ ] Run the five-person test in `docs/user-test.md` and record the results in `docs/user-test-results.md`.
- [ ] Test a complete old-device flow in the extension and with people outside the team. Record observed results without claiming a completed handover unless it happened.
- [ ] Capture the real AWS path in the video. Say whether Bedrock is enabled.
- [ ] Make the GitHub repository public and open it signed out. As checked on 10 October, the configured URL returned 404 when signed out.
- [ ] Publish the short writeup and disclose all coding tools and third-party assets used.
- [ ] Upload and verify the YouTube link, then submit the public repository, video, and writeup through the event form before its deadline.

Repository: https://github.com/RajdeepKushwaha5/EcoCart (public access unverified)

Video: add only after upload and signed-out check.

Writeup: use the text above, then add actual test results and submission links.
