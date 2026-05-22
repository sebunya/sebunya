# Product Pricing Approval Matrix

This document maps out the current pricing status and fallback rules for products in the GoldPlus e-commerce catalogue.

## Pricing Audit Findings

A comprehensive search was performed across all workspace assets, including local files (`.xlsx`, `.csv`, `.json`, `.ts`), migrations, seed scripts, and templates.
- **Results**: No official retail pricing sheet, spreadsheet, or database table holds pricing information for the new canonical GoldPlus products.
- **Current State**: The `retailPriceUgx` fields in `apps/web/src/lib/catalog/catalog.ts` for all new GoldPlus items are configured as `null`.

## Approved Pricing Rules

Until official price lists are provided by the business, the storefront applies the following rendering rules:

1. **Price on Request Fallback**:
   - If a product's `retailPriceUgx` is `null`, `0`, or less, the storefront must NOT display an arbitrary or placeholder price.
   - The product card and Product Detail Page (PDP) must display **"Price on request"** as the price label.
   - The primary call-to-action remains **"Request quote"** or redirects the customer to a dealer/quote pathway.

2. **No Arbitrary Pricing**:
   - Under no circumstances should placeholder pricing (e.g. 1 UGX or fake numbers) be introduced without official confirmation.

## Product Price Map

| SKU / Model | Product Name | Category | Confirmed Retail Price (UGX) | Storefront Price Display |
| --- | --- | --- | --- | --- |
| **GP-PD-W3** | GoldPlus Built-In Cable Power Bank | Power Devices | *None* | Price on request |
| **GP-09** | GoldPlus 100W Portable Power Station | Power Devices | *None* | Price on request |
| **GP-P07** | GoldPlus Digital Display Power Bank | Power Devices | *None* | Price on request |
| **GP-03** | GoldPlus Magnetic Power Bank | Power Devices | *None* | Price on request |
| **GP-X03** | GoldPlus Power Bank with Handle | Power Devices | *None* | Price on request |
| **GP-04** | GoldPlus Slim Power Bank | Power Devices | *None* | Price on request |
| **GP-101** | GoldPlus USB Wall Charger | Power Devices | *None* | Price on request |
| **GP-103** | GoldPlus Dual USB Charger | Power Devices | *None* | Price on request |
| **GP-104** | GoldPlus USB-C Charger Set | Power Devices | *None* | Price on request |
| **GP-105** | GoldPlus 50W Metal Charger | Power Devices | *None* | Price on request |
| **GP-106** | GoldPlus Compact Charger | Power Devices | *None* | Price on request |
| **GP-107** | GoldPlus 50W PPS Charger | Power Devices | *None* | Price on request |
| **GP-108** | GoldPlus PD Fast Charger | Power Devices | *None* | Price on request |
| **GP-CA03** | GoldPlus Dual USB Car Charger | Car Accessories | *None* | Price on request |
| *Pending* | GoldPlus 16GB USB Flash Drive | Storage Devices | *None* | Price on request |
| *Pending* | GoldPlus 32GB Memory Card | Storage Devices | *None* | Price on request |
| *Pending* | GoldPlus USB Mouse | PC Accessories | *None* | Price on request |
| *Pending* | GoldPlus USB Sound Card | PC Accessories | *None* | Price on request |
| **GP-001** | GoldPlus Wireless Earbuds GP-001 | Sound Devices | *None* | Price on request |
| **GP-002** | GoldPlus Wireless Earbuds GP-002 | Sound Devices | *None* | Price on request |
| **GP-003** | GoldPlus Wireless Earbuds GP-003 | Sound Devices | *None* | Price on request |
| **GP-004** | GoldPlus Wireless Earbuds GP-004 | Sound Devices | *None* | Price on request |
| **GP-007** | GoldPlus Wireless Earbuds GP-007 | Sound Devices | *None* | Price on request |
