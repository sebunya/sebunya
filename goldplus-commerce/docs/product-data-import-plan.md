# Product Data Import Plan

This document outlines the strategy for importing bulk product data into the GoldPlus Commerce OS.

## 1. Expected Data Sources
- **Source Files**: Expected in `/imports/products/` (CSV or JSON).
- **Artwork/Images**: Expected in `/imports/images/` with filenames matching SKUs or model numbers.

## 2. CSV Structure (Mandatory Columns)
| Column | Description | Type | Rules |
|--------|-------------|------|-------|
| `sku` | Unique identifier | String | Mandatory, Unique |
| `name` | Product title | String | Mandatory |
| `model_number` | Manufacturer model | String | Mandatory |
| `category` | Product category | String | Mandatory |
| `price_ugx` | Retail price | Number | Optional for Draft |
| `stock` | Initial quantity | Number | Mandatory |
| `specifications` | JSON string of specs | String | Optional |

## 3. Transformation Logic
- **Slug Generation**: Created from `name` (lowercase, hyphenated).
- **Status Assignment**: All imported products are set to `draft` by default.
- **Validation**: Rows missing `sku` or `model_number` are logged to `docs/imports/rejected_rows.json`.

## 4. Import Workflow
1. **Prepare**: Place files in `/imports/`.
2. **Run Script**: `pnpm db:import-products`.
3. **Review**: Check `Missing. Requires admin review.` flags in Admin Dashboard.
4. **Publish**: Admin manually reviews and publishes products.

## 5. Script Skeleton
The import script will be implemented in `scripts/import-products.ts` using Drizzle.

## 6. Anti-Hallucination Guardrails
- DO NOT invent missing specifications.
- DO NOT invent prices if missing.
- Use "Missing. Requires admin review." for any field not present in source.
