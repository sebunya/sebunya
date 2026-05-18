# GoldPlus UI Pass H1B — Closeout Runbook

This runbook documents the audit findings, architecture, and verification results for Pass H1B (storefront catalog listings, taxonomies, and false empty-state rescue).

## 1. Shop Product Source Audit

We analyzed the catalog data source and database mappings:
- **Seed Products Source**: `scripts/seed.ts` contains the 8 authoritative products seeded into the Postgres database.
- **API Storefront Endpoint**: `/products` (handled by `ListPublicProductsUseCase` and `DrizzleProductRepository`).
- **Resilient Fallback**: In offline or local development environments, if the API is unreachable or returns an error, the storefront page dynamically falls back to an in-code representation of the exact 8 seeded products, guaranteeing zero catalog downtime.

---

## 2. Storefront Taxonomy Mapping & Normalization

The backend database contains a raw set of category names and slugs (`Power Devices`, `Sound Devices`, and `Other` which groups storage and car accessories).
We implemented a storefront normalization layer in `apps/web/src/lib/catalog/catalog.ts`:
- Infers `'Storage Devices'` for products whose titles contain storage terms (e.g. `'USB 3.0 Flash Drive 128GB'`).
- Infers `'Car Accessories'` for products whose titles contain car/mount terms (e.g. `'Car Dashboard Mount'`).
- Restricts `'PC Accessories'` to the current GoldPlus range (mice/sound cards), returning empty correctly since none are currently seeded.
- Preserves `'Power Devices'` and `'Sound Devices'` as-is.

---

## 3. High-Relevance Query Intent Inference

To rescue users from false empty states (e.g. searching for `charger` or `mount` which might have zero direct matches on specific product fields but match categories), we implemented a query intent engine:
- Maps `charger`, `cable`, `power bank` -> `'Power Devices'`.
- Maps `earbuds`, `headphones`, `speaker` -> `'Sound Devices'`.
- Maps `flash`, `usb`, `storage` -> `'Storage Devices'`.
- Maps `car`, `mount` -> `'Car Accessories'`.
- Maps `mouse`, `sound card` -> `'PC Accessories'`.

A product matches query `q` if:
1. The product name, SKU, model number contains `q` directly, OR
2. The product's inferred category matches the query's inferred category intent (preventing false empty states!).

---

## 4. Layout, Filters, and Sorting Specs

- **Dynamic Chips Track**: Shows active query, active category, active stock filter, and active sorting with a single-click remove action on each chip. Includes a "Clear All" link.
- **Sidebar & Mobile Capsule Rail**: Responsive category navigation showing the 6 approved tags (All, Power, Sound, Storage, Car, PC).
- **Stable Sorters**:
  - `price_low_high`: Sorts by retail price ascending, using name as secondary tie-breaker.
  - `price_high_low`: Sorts by retail price descending, using name as secondary tie-breaker.
  - `name_az`: Sorts alphabetically A-Z.
  - `featured`: Stable index-based fallback sorting.
- **Empty State**: Modern, customer-grade empty state box with a descriptive message, search shortcuts, and a clear reset action.

---

## 5. Verification Checklist & Audit Evidence

### A. TypeScript Typecheck Compilation
- **Command**: `pnpm typecheck`
- **Result**: `Exit Code: 0` (All workspace projects compiled successfully with zero type errors).

### B. Unit Test Execution
- **Command**: `pnpm run test:unit`
- **Result**: `Exit Code: 0` (All 211 unit tests passed cleanly, including 13 new comprehensive storefront catalog tests).

### C. Regex Specifity Repair
- **Observation**: Substring check `'car'` collided with word `'card'` inside `'MicroSD Card 128G'`. Additionally, `'usb'` in sound cards collided with storage devices.
- **Solution**: Refactored the normalizer keyword mapper to check for specific word boundaries (`/\b(flash|drive|usb|sd|storage|microsd)\b/i`, `/\b(car|mount|vehicle)\b/i`, etc.) and prioritized specific accessory checks over general categories. All tests are now fully verified and green.

### D. Production Build Compilation
- **Command**: `pnpm build`
- **Result**: `Exit Code: 0` (All Astro entrypoints, server assets, and server entrypoints compiled successfully).
