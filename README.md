# EcoCart

A Chrome extension for Amazon.in and Flipkart. On phones, laptops, tablets, watches, earbuds, TVs, home appliances and other
electronics, it shows sourced facts: how long the maker promises security updates, the maker's reported lifecycle carbon in
everyday terms, and the BEE energy star rating the listing states. Then it helps the buyer plan what happens to the device
they are replacing, using exchange, resale and recycling routes taken from each company's own page.

Recognised device pages get the old-device plan. Devices in the catalog (about 170) also get their sourced facts: a curated set with
lifecycle carbon, plus every Xiaomi, Redmi, POCO, OnePlus and realme model from the makers' official support lists. Other physical
products, from T-shirts to rice to books, get a category estimate when EcoCart can read a price and match a category. The card
clearly labels it as an estimate and adds any energy or certification labels the listing states. The estimate uses Open CEDA's average emissions per rupee for that kind of
product in India; it is never presented as a measured figure.

Coverage and the checks needed before claiming reliable support across both stores are in [docs/live-coverage.md](docs/live-coverage.md).

## What it does

| Where | What you see |
|---|---|
| Device page (Amazon.in, Flipkart) | The device passport: update support, lifecycle carbon with comparisons, energy stars for TVs and appliances, a longer-supported alternative when the evidence allows, and the old-device plan. Devices outside the catalog still get the plan. |
| Every card | Three steps: **What we know** (sourced facts or a labelled estimate), **What this means** (a scorecard of separate facts, no verdict, and everyday comparisons), and **What you can do**: add it to your shortlist, choose a same-maker lower-footprint device at a similar price ("I'll choose this instead"), a renewed listing of the same model, 5 star appliances, refill packs, and labelled general tips. |
| Any other product page | A footprint estimate for its category at the page price, with the method and dataset one tap away, and the labels the listing states (BEE stars, GOTS, FSC and others). Digital items, gift cards and renewed items get nothing. |
| Search results | A small badge on devices with sourced facts, such as "Updates till at least Mar 2033". Accessories never get one. |
| Order confirmation | A reminder to plan for the old device, if you looked at one in the last 48 hours. |
| Toolbar popup | Your plant, which grows one stage for each completed plan, and your open plans. Updates the moment a plan changes. |
| Dashboard | What changed because you used EcoCart, updated live. **Overview**: plans waiting, handovers reported by you, handovers verified with a receipt, the footprint difference of your choices (maker-reported, same maker only), the electricity difference of appliance choices, and products checked; tap any number to see what it counts, its source and its evidence level. **My actions**: each plan from Planned to Reported done to Verified, with route details and the next step first. **My comparisons**: your shortlist, compared only within the same kind of evidence, and your choices with their stage (considering, chosen, bought). **My progress**: an activity chart by day, filtered by month and type. The rules are in [docs/impact.md](docs/impact.md). |
| Website | A public page hosted on AWS Amplify: four use-case journeys with real screenshots, **Try EcoCart** (saved sample listings answered live by the API, no install needed), and live totals that refresh every 20 seconds. Plain HTML, CSS and canvas animations, no frameworks. |

## How it works

```
Amazon.in or Flipkart page
   | content scripts: one reader per shop (sites.js), product card, search badges, order-page reminder
Chrome extension (Manifest V3)
   | background service worker calls the API
Amazon API Gateway (HTTP API, throttled)
   |
AWS Lambda (Python 3.12), deployed with AWS SAM
   |-- DynamoDB: Products, Options, Factors, Actions, Sessions, Stats
   |-- estimates.json: India factors built from Open CEDA 2025, and the breadcrumb rules
   '-- Amazon Bedrock (optional): short summary written only from the sourced facts,
       and a category pick from a fixed list when no breadcrumb rule matches

Website (site/) on AWS Amplify Hosting, reading GET /stats
```

- Product pages: matching uses model numbers and aliases from the catalog. If a title matches more than one device, the user picks the right one.
- Search pages: the extension downloads the catalog once and matches titles in the browser. Result titles are never sent anywhere. Accessory titles (cases, covers, chargers) are skipped.
- Other product pages: the breadcrumb picks a category from `data/sectors.json`, and the price times that category's factor gives the estimate. See [docs/method.md](docs/method.md).
- Order page: nothing on the page is read. The reminder uses the device you last looked at, which is stored only in your browser.
- Actions are tied to an anonymous session. The extension keeps a random token; the server stores only its SHA-256 hash.
- The API is called on product pages (title, breadcrumb, listing details and price), on search pages (catalog only), and when you save or view plans.

See [docs/method.md](docs/method.md) for the evidence rules.

## API

| Method | Path | Notes |
|---|---|---|
| POST | `/match` | `{title, details, category}` returns `{modelId, matchType, candidates}` |
| POST | `/estimate` | `{title, crumbs, price}` returns a labelled category estimate, or `{estimate: null, reason}` |
| GET | `/products/{modelId}?price=` | Sourced facts, headline, carbon with comparisons, alternative, summary |
| GET | `/catalog` | Aliases and badge text for every catalog device |
| GET | `/factors` | Sourced conversion factors (public) |
| GET | `/stats` | Public totals: plans saved, plans marked done, plans verified, devices covered |
| GET | `/options?city=&brand=&category=` | Verified old-device options |
| POST | `/sessions` | Returns an anonymous token |
| POST | `/actions` | Bearer token, at most 50 plans per session. `{modelIdBought}` or `{listingName, category}`, plus `{oldDevice: {brand, ageYears}, city, optionId}` |
| GET | `/actions` | Bearer token. This session's plans |
| PATCH | `/actions/{actionId}` | Bearer token. `{status: "planned" or "done"}`. A verified plan cannot go back to planned. |
| DELETE | `/actions/{actionId}` | Bearer token |

## Run locally (no AWS)

```
python scripts/local_server.py
```

This runs the same Lambda handler on `http://localhost:3000`, reading `data/` directly. Sessions and plans are kept in memory. `extension/config.js` points at it by default. It is for development only; the submitted project runs on AWS.

## Setup

Requirements: Python 3.12+, AWS CLI with credentials, [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html), Chrome.

1. **Fill the data.** Add devices to `data/products.json`, old-device options to `data/options.json` and conversion factors to `data/factors.json`. Every value needs an `https://` source and a `checked` date. Then run:
   ```
   python scripts/validate_data.py
   ```
2. **Build the category factors.** This downloads Open CEDA 2025 from the public AWS Open Data bucket into `research/` once,
   converts the India factors to rupees and checks `data/sectors.json`:
   ```
   python scripts/build_estimates.py
   ```
3. **Deploy the backend.**
   ```
   cd backend
   sam build
   sam deploy
   ```
   To turn on the Bedrock summary, first enable model access in the Bedrock console, then deploy with
   `sam deploy --parameter-overrides BedrockModelId=<model or inference profile ID>`.
4. **Refresh prices and seed the tables.** Prices older than 7 days are ignored. After the first deploy, the daily job keeps them fresh.
   ```
   python scripts/refresh_prices.py
   ```
   Then seed:
   ```
   python scripts/seed.py --stack-name ecocart-india --region ap-south-1
   ```
5. **Publish the website.**
   ```
   python scripts/deploy_site.py
   ```
   This creates the Amplify app on the first run and prints the site address.
6. **Check the live API.**
   ```
   python scripts/smoke_test.py <ApiUrl>
   ```
7. **Load the extension.** Put the `ApiUrl` output from step 3 into `extension/config.js`. Open `chrome://extensions`, turn on Developer mode, click "Load unpacked" and choose the `extension` folder. Also put the API host in `host_permissions` in `extension/manifest.json`; it lists the exact host, not a wildcard.

## Keeping it running

- **Makers' support lists** refresh every Sunday at 03:00 IST: a scheduled Lambda (`support_job.py`) re-reads the
  Xiaomi (with Redmi and POCO) and realme lists, adds new models, updates changed dates and removes models whose
  support has ended. If a source is down, its brands' entries are kept; the `ecocart-india-support-lists-failed`
  alarm emails the alerts topic only if no list could be read. OnePlus entries come from a saved copy of its page.
- **Prices** refresh every day at 09:00 IST: a scheduled Lambda (`price_job.py`) reads the official store pages and
  updates the Products table. If a price cannot be read, the job fails and the `ecocart-india-price-refresh-failed`
  alarm emails the alerts topic. `seed.py` never replaces a newer price from the table with an older one from the file.
- **Category gaps:** breadcrumbs that no rule matched are counted (the breadcrumb only). Each week, run
  `python scripts/list_gaps.py`, add terms for the top ones to `data/sectors.json`, then run `build_estimates.py` and
  deploy. Add `--clear` once they are covered.
- **Verified handovers:** when the team has seen a collection receipt or the collector's written confirmation for a plan,
  record it with `python scripts/verify_handover.py --action-id <plan ID> --evidence "<what was seen>"`. The plan ID is
  shown on each plan in the dashboard. See [docs/impact.md](docs/impact.md).
- **Try EcoCart samples:** `site/samples.json` holds listings saved from the shops with their date. Refresh the prices
  now and then; the answers always come live from the API. The API accepts browser calls only from the website
  (`SiteOrigin` in `backend/template.yaml`).
- **Store release:** raise the version in `extension/manifest.json`, run `python scripts/package_extension.py`, and upload
  `dist/ecocart-<version>.zip`. The listing text, screenshots and form answers are in [docs/store/listing.md](docs/store/listing.md).

## Makers' official support lists

`python scripts/import_support_periods.py` reads the per-model security update lists that makers publish (Xiaomi, Redmi and
POCO; realme; OnePlus) into `data/support_periods.json`, keeping only models still in support. `seed.py` turns each row into a
catalog entry with that one sourced fact; models in `data/products.json` are curated by hand and always take precedence. The
OnePlus page builds its table in the browser, so save the page text and pass `--oneplus-text <file>`.

## Agent teams (Strands Agents SDK)

Two small teams of agents, built with the open-source [Strands Agents SDK](https://strandsagents.com), keep the data growing.
They run on Amazon Bedrock, or on any OpenAI-compatible model on your machine while Bedrock access is pending. Locally they default to
[Ollama](https://ollama.com) (`ollama serve`, then `ollama pull qwen2.5:7b`), which uses an NVIDIA GPU when there is one.
Set `ECOCART_LOCAL_URL` for another server, and `ECOCART_LOCAL_KEY_FILE` for a hosted one that needs a key. The agents only propose: plain code checks every claim, and a person approves before anything goes live.

| Team | Agents | What it does |
|---|---|---|
| Catalog research | Catalog Lead, Source Scout, Fact Extractor, Evidence Checker | Finds the maker's own documents for a device, quotes the passage behind each fact, keeps only facts whose quote is found word for word in the source, and writes a draft catalog entry. The Scout may only open the makers' domains listed in `agents/ecocart_agents/official_sources.json`. |
| Category mapping | Category Mapper, Rule Reviewer | Takes breadcrumbs the live API could not match (from the gap log), proposes a category for each, and drafts a rule only when both agents pick the same category from the allowed list and the words are really in the breadcrumb. |

```
cd agents
python -m venv .venv && .venv/Scripts/pip install -r requirements.txt     # separate from the SAM CLI's environment
.venv/Scripts/python -m ecocart_agents research --brand Apple --name "Watch Series 12" --category watch
.venv/Scripts/python -m ecocart_agents map-gaps --from-gaps
.venv/Scripts/python -m ecocart_agents --model local:qwen2.5:7b map-gaps --breadcrumb "Toys & Games > Kites"
cd ..
python scripts/approve_draft.py drafts/apple-watch-series-12.json
python scripts/approve_rules.py drafts/rules-YYYY-MM-DD.json
```

The agents have their own environment because the Strands SDK and the SAM CLI need different versions of one library.

## Tests

```
python -m venv .venv
.venv/Scripts/pip install -r requirements-dev.txt   # on macOS or Linux: .venv/bin/pip
.venv/Scripts/python -m pytest backend/tests
node --test extension/tests/*.test.js
agents/.venv/Scripts/python -m pytest agents/tests
```

The end-to-end test drives the real extension in Chrome or Edge on live Amazon.in and Flipkart pages: the card in three
steps on both shops, a recorded lower-footprint choice, the shortlist, an old-device plan saved, marked done from the
popup while the dashboard updates live, and deleted again.

```
cd tests/e2e && npm install && node journey.js
```

## Data format

`data/products.json`, one object per device:

```json
{
  "modelId": "samsung-galaxy-a55",
  "brand": "Samsung",
  "displayName": "Samsung Galaxy A55 5G",
  "aliases": ["Galaxy A55"],
  "modelNumbers": ["exact model number from the listing"],
  "excludes": ["words that mean a different model, such as Pro or Plus"],
  "priceInr": { "value": 0, "source": "https://...", "checked": "YYYY-MM-DD" },
  "updatePolicy": { "value": "exact wording", "supportEndDate": "YYYY-MM", "source": "https://...", "checked": "YYYY-MM-DD" },
  "repairability": { "value": "...", "scale": "...", "source": "https://...", "checked": "YYYY-MM-DD" },
  "lifecycleCo2eKg": { "value": 0, "source": "https://...", "checked": "YYYY-MM-DD" },
  "takeBack": { "value": true, "source": "https://...", "checked": "YYYY-MM-DD" }
}
```

Use `null` for any fact you could not verify.

`data/options.json`, one object per option (`categories` is optional; an empty or missing list means any device):

```json
{
  "city": "delhi-ncr",
  "optionId": "short-unique-id",
  "name": "Organisation name",
  "type": "exchange | recycle | reuse",
  "brands": [],
  "accepts": "What they take",
  "handover": "How a person hands the device over",
  "address": "Public drop-off address, if any",
  "url": "https://...",
  "handoffConfirmed": false,
  "source": "https://...",
  "checked": "YYYY-MM-DD"
}
```

An empty `brands` list means the option accepts any brand.

`data/factors.json`, one object per everyday comparison:

```json
{
  "factorId": "petrol-car-km",
  "unit": "km in a petrol car",
  "kgCo2ePerUnit": 0,
  "source": "https://...",
  "checked": "YYYY-MM-DD"
}
```

A comparison is only shown when its factor has a value and a source. The card divides the device's reported lifecycle CO2e by the factor and rounds to two significant figures.

## Credits

Category estimates use [Open CEDA 2025](https://openceda.org/), CEDA by Watershed, licensed CC BY-SA 4.0. The derived
factors in `backend/src/estimates.json` are shared under the same licence.

Typefaces: Instrument Sans, Instrument Serif and JetBrains Mono, under the SIL Open Font License (see `extension/fonts/OFL.txt`).

The idea of showing environmental information while shopping was inspired by the public [EcoCart project from 2023](https://github.com/Sebastian-Chai/EcoCart/). No code or assets from that project are used here.

AI tools used: Claude Code (Anthropic) and OpenAI Codex helped write and review code and documentation.

The hackathon submission draft and final checks are in [docs/submission.md](docs/submission.md).

## License

MIT
