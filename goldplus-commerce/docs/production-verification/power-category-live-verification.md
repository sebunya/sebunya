# Production Verification Runbook: Power Category Rollout

- **Verification Date:** May 22, 2026
- **Production HEAD Verified:** `2fd0f22` (newer than `bb4090b`)

## Issue Summary
Historically, a discrepancy was flagged where old generic Power category items (`Generic Fast Charger`, `Reinforced USB-C Cable`, `Heavy Duty Power Bank`) were suspected to still be loaded by the storefront via fallback recommendations. 

A thorough investigation was executed against the production server (`178.104.214.242`) running the `phase-1-functional-depth` branch.

## Results & Findings
The verification proved that the reported issue was a **false positive** due to:
1. **Noisy Grep:** Previous grep commands on minified HTML returned large blocks containing generic styles or markup, which were mistakenly flagged.
2. **Category Fallback Signal:** The presence of `CATEGORY_FALLBACK` was treated as an old product indicator. However, `CATEGORY_FALLBACK` is a system recommendation reason code and is completely harmless because it maps exclusively to the active new GoldPlus products.

### New Product Positive Checks
All six new products are correctly loaded in the storefront grids and recommendation rails:
- GoldPlus Built-In Cable Power Bank (GP-PD-W3)
- GoldPlus 100W Portable Power Station (GP-09)
- GoldPlus Digital Display Power Bank (GP-P07)
- GoldPlus Magnetic Power Bank (GP-03)
- GoldPlus Power Bank with Handle (GP-X03)
- GoldPlus Slim Power Bank (GP-04)

### Old Product Negative Checks
Zero matches were found in the live HTML for:
- Stale product names
- Stale slugs
- Stale SKUs
- Stale UUIDs
- Unsplash fallback image URLs

### PDP and Image Route Results
All PDP routes resolve to `200 OK`. All image assets resolve to `200 OK` and serve as `image/webp`.

---

## Reusable Verification Runbook
To verify future catalogue updates without noisy output, run the automated script located at `scripts/qa/verify-power-category.sh`.

### Local/Container Execution:
```bash
./scripts/qa/verify-power-category.sh http://localhost:4321
```

### Live Production Execution:
```bash
./scripts/qa/verify-power-category.sh https://shopgoldplus.com
```

### Protected Systems Confirmation
This verification confirms that:
- Checkout & Payments (PesaPal) are untouched.
- Cart UI, Footer layout, and base layout are untouched.
- Notification dispatching remains isolated and stable.
- Environment variables and Caddy configurations are untouched.
