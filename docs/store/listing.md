# Store listing: Chrome Web Store and Edge Add-ons

Everything needed to fill in the store forms. Upload `dist/ecocart-<version>.zip` from `python scripts/package_extension.py`.

## Basics

- **Name:** EcoCart
- **Summary (132 characters max):** See sourced device facts, footprint estimates and eco labels on Amazon.in and Flipkart, then plan where your old device goes.
- **Category:** Shopping
- **Language:** English (India)
- **Homepage:** https://main.d3ogmfe7tt7uwb.amplifyapp.com/
- **Privacy policy:** https://main.d3ogmfe7tt7uwb.amplifyapp.com/privacy.html
- **Screenshots (1280 x 800):** `docs/store/1-phone.png`, `2-tshirt.png`, `3-labels.png`, `4-flipkart.png`
- **Icon (128 x 128):** `extension/icons/icon-128.png`

## Description

EcoCart adds a small card to product pages on Amazon.in and Flipkart.

Buying a phone, laptop, tablet, watch, earbuds or TV? See how long the maker promises security updates, the lifecycle carbon the maker reports, compared with everyday things like km driven, and the BEE energy rating the listing states. Every fact links to the official source it came from. If a maker has not published something, the card says so instead of guessing.

Buying anything else, from T-shirts to rice to books? See a footprint estimate for that kind of product at that price. It is clearly labelled as a category estimate, not a measurement, and the method and dataset (Open CEDA by Watershed) are one tap away. Eco labels the listing mentions, such as GOTS, FSC or Fairtrade, are shown with a link to the scheme.

Every card starts with a short "Before you buy" summary of separate facts, never a verdict, and lists better options only where there is evidence: a longer-supported or lower-footprint device at a similar price, a renewed listing of the same model, a 5 star appliance, or a refill pack.

Replacing a device? EcoCart helps you plan what happens to the old one: exchange, sell or recycle it, using routes taken from each company's own page, in Bengaluru, Chennai, Delhi NCR, Hyderabad, Kolkata, Mumbai and Pune. Mark the plan done when it is handed over and your plant grows.

- No account, no ads, no tracking
- Search results are matched inside your browser
- Order pages are never read

## Single purpose

Shows sourced environmental information about the product on Amazon.in and Flipkart product pages, and helps the user plan reuse or recycling of the device they are replacing.

## Permission justifications

- **storage:** Keeps a random session token, recently viewed devices, confirmed device matches and the last chosen city in the user's browser.
- **Host permission for www.amazon.in and www.flipkart.com:** Reads the product title, category path, details and price on product pages, and shows the card and search badges.
- **Host permission for the EcoCart API (8el9hdnif0.execute-api.ap-south-1.amazonaws.com):** Fetches product facts and estimates, and saves the user's plans.
- **Remote code:** None. All code is in the package; the API returns data only.

## Data usage form

Tick these, and leave the rest unticked:

- **Location:** the city the user picks for an old-device plan.
- **Website content:** product title, category path, details and price from the product page being viewed.

Then certify all three statements: not sold to third parties, not used for purposes unrelated to the single purpose, not used for creditworthiness or lending.

## Before each upload

1. Raise `version` in `extension/manifest.json`.
2. Run the tests, then `python scripts/package_extension.py`.
3. Check that `extension/config.js` and `host_permissions` point at the live API.
