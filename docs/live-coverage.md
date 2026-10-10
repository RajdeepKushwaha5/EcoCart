# Live shopping coverage

EcoCart works on Amazon.in and Flipkart product pages. The extension reads the page in the shopper's browser, then asks the AWS API for catalog facts or a category estimate. The live API currently returns a catalog of 170 devices. The curated file contains 50 devices, 42 with a manufacturer-reported lifecycle carbon figure. There are 63 old-device routes across seven cities. These counts can change when the catalog is seeded or support lists refresh.

## What a shopper should see

| Page | EcoCart response |
|---|---|
| Catalog device | Official support and carbon facts when published, links to sources, and an old-device plan. |
| Device outside the catalog | An honest unknown-facts state, labels stated on the listing, and an old-device plan. |
| Other physical product with a readable price and category | A clearly labelled category average from Open CEDA. It covers production up to the factory gate, not this exact item or delivery. |
| Product with no price or category match | A card explaining why there is no estimate. |
| Digital item, gift card, service, used or refurbished item | No new-product footprint estimate. |

This is broad product-page coverage, not a measured footprint for every SKU. A product title and shop price cannot reveal its factory, material quantities, packaging weight, shipping route, or lifetime. EcoCart must not claim those as known. The maker's lifecycle report and a spend-based category average use different boundaries and must not be compared or added together.

## Before calling it reliable in real shopping

1. Build a test set of at least 100 current product URLs per shop. Include the major departments, catalog and non-catalog devices, products with no offer, digital products, and variant changes. Record the URL, expected category, expected price, card state, and date tested. Keep screenshots or saved DOM snippets for selector failures, without account or order data.
2. On each URL, check that the card appears within 10 seconds, stays near the product title and price, and updates after a variant change. Verify that a missing price produces no number and that a known catalog device is not mistaken for an accessory.
3. Compare the price and category EcoCart read with what a person sees on the page. Treat mismatches as failures even if the API returned a number. Check the estimate label, source link and scope text on every sample.
4. Track separate rates for Amazon and Flipkart: card appearance, correct price, correct category, correct catalog match, and successful plan save. Fix the highest-volume failures before adding more effects or categories. Aim for at least 95% card appearance and price extraction on the test set, and zero unlabelled estimates or invented device facts.
5. Repeat the sample after site layout changes and each extension release. Add regression fixtures for any selector or routing bug found in the browser. The automated tests alone cannot prove live page coverage.

## Next product improvements

- Add a small in-card correction action for a wrong category or price. Store only the category, shop, and a coarse error code for review; do not collect a shopper's page text without consent.
- Expand verified device data only when the exact model and region are supported by the source. Keep unknown values visible.
- Add cart-level advice only when item identity, quantity, and price are reliably readable. A cart total built by summing category averages would still be an estimate and must be labelled as such.
- Test the old-device options with real people. Count confirmed handovers separately from self-reported completed plans before making impact claims.

The earlier EcoCart demo made the shopping moment visible and memorable. This version should keep that immediate card and plant, while making every number traceable and rewarding a real old-device handoff rather than another purchase.
