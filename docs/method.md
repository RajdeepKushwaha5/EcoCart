# Evidence method

This page explains what EcoCart shows, where it comes from, and what it will not claim.

## What the card shows

| Field | Where it comes from |
|---|---|
| Update support headline | The manufacturer's published update policy for this exact model. We show an end date only when the source gives one. Otherwise we quote the policy wording, or show "Unknown". |
| Update policy | The manufacturer's exact wording, with a link. |
| Repair information | A published source, with its own scale. Scores from different organisations are not compared. |
| Lifecycle carbon | The manufacturer's product environmental report, if one exists. Otherwise "Not published". |
| Everyday comparisons | The lifecycle figure divided by a published conversion factor, such as kg CO2e per km for a petrol car. Both the device figure and the factor link to their sources. Rounded to two significant figures and marked as approximate. |
| Manufacturer take-back | Whether the brand runs a take-back programme in India. This is an end-of-life route, not a measure of how long the device lasts. |

Every value in `data/products.json`, `data/options.json` and `data/factors.json` has a source URL and a checked date. `scripts/validate_data.py` refuses to seed data that breaks this rule, and the API returns any fact without a source as null.

Lifecycle figures from different manufacturers can use different methods, so we never rank across manufacturers. Charts use one manufacturer, one device category and the same report basis. A storage-specific figure is applied only when the listing's storage matches; unverified regional figures stay visible as reference reports and are excluded from that listing's totals and comparisons.

## Makers' official support lists

Some makers publish the security update end date of every model they sell: Xiaomi (with Redmi and POCO) in its Product
Software Support Information list, and realme and OnePlus in their UK PSTI tables. EcoCart imports these lists as they are,
with the page as the source, and shows the date as "Security updates until at least". Models without a published date say so.

## Category estimates (every other product)

Clothing, food, books, toiletries, furniture, accessories and most other products have no published per-product footprint. For these EcoCart shows a category estimate, labelled "Category estimate, not measured for this product" on the card.

- **The number** is the price on the page multiplied by the average emissions per rupee for that kind of product in India, from [Open CEDA 2025](https://registry.opendata.aws/open-ceda/) (CEDA by Watershed, CC BY-SA 4.0). It is rounded to two significant figures and shown as "About".
- **The factor** is CEDA's India figure in kg CO2e per US dollar of producer price (2023), converted with the tables in the same workbook: the purchaser-to-producer ratio (a shop price includes trade and transport margins), the sector price index for 2025, and the 2025 rupee rate. `scripts/build_estimates.py` does this and writes `backend/src/estimates.json`.
- **The category** comes from the shop's breadcrumb, matched against fixed rules in `data/sectors.json`, most specific crumb first. A crumb is tried whole, then by its last two words and its last word ("Tata Tea Premium Tea Powder" is tea powder). Some rules apply only inside a department, so "Shampoos" under Car & Motorbike is a car cleaner. Pages without a breadcrumb use the listing's Generic Name and Best Sellers Rank categories, and the title as a last resort. For water bottles and lunch boxes the title picks the material (steel, plastic or glass). If no rule matches and a Bedrock model is configured, the model may pick a category, but only from the same fixed list; any other answer is thrown away. The model never produces a number.
- **What it covers:** making the product and its materials, up to the factory gate. Use and disposal are not included.
- **When there is no estimate:** the card still appears and says why (no readable price, or a category we have not matched yet). Digital items, gift cards, services and renewed items get no card.

Spend-based estimates are averages over whole industries, so a particular product can be well above or below. Prices include GST, which the method does not remove. That is why the figure is never compared with a manufacturer's measured footprint, and devices with their own passport do not get one.

## Before you buy, and better options

Each card starts with a short scorecard. Every line is a separate fact; nothing is added up into a score or a buy-or-skip verdict, because for most products we do not have the measured data such a verdict would need.

- **Security updates:** the support end date, with a bar showing where it falls between the earliest and latest dates of the same kind of device in the catalog.
- **Reported footprint:** the maker's figure, with a bar against the same maker's devices of the same kind only. Makers measure lifecycle carbon differently, so different makers are never placed on one bar.
- **Per rupee spent (estimates):** where the product's category sits among all the categories EcoCart can estimate. It describes the category, not the product.
- **Energy rating and labels:** as stated on the listing.

Better options are shown only when there is evidence for them:

- **Similar price, longer support** and **same maker, lower footprint:** catalog devices of the same kind, with a store price checked in the last 7 days and within 20% of the page price. Each shows its sources and the configuration the footprint refers to.
- **Buy it renewed:** for devices, the extension runs one search on the shop for a renewed listing. A listing is shown only if its title says renewed or refurbished and names the same model (catalog aliases for catalog devices, every word of the model name otherwise). If none is found, a search link is shown instead.
- **Running it:** for TVs and appliances, the yearly kWh from the listing's label, converted with the CEA grid factor, and a link to 5 star models when the rating is lower.
- **Less packaging:** for detergents, soaps and personal care, a search link for refills and bigger packs.
- **General tips** are labelled as general and are not about the product.

## Labels on the listing

The card shows a BEE star rating when the listing's details, title or bullet points state one, and the names of recognised certification schemes (GOTS, OEKO-TEX, FSC, Fairtrade, Jaivik Bharat and a few others) when the listing mentions them. Each links to the scheme's own site. These are claims made by the seller, and the card says EcoCart has not checked them. If Amazon shows its own sustainability badge on the page, its text is shown too.

## The agent teams

EcoCart uses two teams of agents built on the Strands Agents SDK. Neither team can change what shoppers see on its own.

- **Catalog research.** The Catalog Lead sends the Source Scout to find the maker's own documents, limited to the maker's
  official domains. The Fact Extractor quotes the passage behind each fact. A plain-code check then keeps a fact only if its
  quote appears word for word in the document and contains the value; the Evidence Checker explains the result for the
  reviewer. The draft is written from the checked facts only, never from what an agent says it found.
- **Category mapping.** For breadcrumbs that no rule matched, the Category Mapper proposes a category and the Rule Reviewer
  decides on its own. A rule is drafted only when both pick the same category from the list EcoCart already estimates, and
  the words are in the breadcrumb. The number shown to shoppers still comes from the dataset, never from a model.

Drafts go to `drafts/`. `scripts/approve_draft.py` and `scripts/approve_rules.py` show every quote or reason and ask a person
to type "yes" before anything is merged.

## Search badges

A device in search results gets a badge only when we hold a sourced fact for it: its security update end date, or failing that, a note that its lifecycle CO2e is published. Titles are matched in the browser against the catalog, and accessory titles such as cases and chargers are skipped.

## When we suggest another device

We only suggest an alternative when all of these are true:

1. The price on the Amazon.in page can be read.
2. The current device has a published support end date.
3. The alternative has a later published support end date.
4. The alternative's price was checked in the last 7 days and is within 20% of the page price.

The card shows the alternative's price with its checked date, because it is not a live quote. It also states that longer software support does not by itself mean lower emissions.

## Old-device options

Each option is checked by hand: the organisation, what it accepts, and how a person actually hands a device over. A registered recycler's facility address is not treated as a public drop-off point unless we confirmed it. The card says whether our team confirmed the handoff directly.

## The summary text

By default the summary is built from a fixed template using the facts above. If a Bedrock model is configured, the model writes the summary from the same facts. Its output is rejected, and the template is used instead, if it contains a number, month or brand that is not in the facts, or claims such as "greener" or "sustainable". These checks reduce risk but cannot prove every sentence is accurate, so the card labels generated text.

## What we never do

- Fill a missing value with a guess or a random number.
- Present a category average as if it were measured for the product.
- Claim "kg of CO2 saved" or "kg recycled".
- Combine different facts into a single score.

## What we measure

The popup counts plans saved and plans marked done. "Done" is reported by the user and is labelled as such. The plant grows one stage per completed plan. It rewards what happens to the old device, never buying more.

## What stays in the browser

The list of devices you checked, and the device used for the order-page reminder, are stored only in your browser. The order confirmation page itself is never read.

On a product page, the title, the breadcrumb, the listing details and the price are sent to the EcoCart API to match the device or work out the estimate. Nothing else from the page is sent, and none of it is stored.
