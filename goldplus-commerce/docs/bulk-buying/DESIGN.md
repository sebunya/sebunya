# Bulk buying: design

Owner request (2026-09-25): "design a better dealer or bulk buyer journey where a
bulk buyer can check multiple products and multiple quantities across all
product categories on the website."

This document is the design and the record of what was built in the first slice.
CLAUDE.md applies throughout: Phase 1 only, no invented facts, no fake urgency or
scarcity, dealer pricing and supplier costs never public, every mutation through
an application use case.

## 1. Current state (before this work)

| Surface | What it does | Gap |
|---|---|---|
| `/quote-request` | One free-text "Product or category" box and one free-text "Quantity" box, a buyer-type radio (retail bulk / wholesale / corporate), a location picker and notes. Posts to `POST /governance/quotes/request`. | A buyer of 20 different products has to type them all into one box. Nothing is tied to a real product, so sales re-keys every request and the buyer never sees a price. |
| `/quotes` | 308 to `/quote-request`. | - |
| `/dealers/apply` | Dealer application (business, TIN, location). | Applies only. No way for an applicant or an existing dealer to send a stock list. |
| `/dealers/dashboard` | An honest placeholder: "no self-service dealer portal". | Dealers are told to phone or WhatsApp. |
| Cart | 1 to 99 per product, at most 50 distinct products (`MutateCartUseCase`). Adding is one product per form POST from a product card or product page. | A reseller buying 30 products clicks 30 times across the shop, and anything over 99 is refused. |
| `quote_requests` table | One product name string and one quantity string per row. No reference a buyer can quote, no business name, no lines. | Cannot hold a list. |
| Buyer status | None. The acknowledgement SMS quoted the row UUID. | A buyer cannot check what happened to a request. |
| Admin `/admin/quotes` | Table of name, email, product string, quantity string, date, status. | Status can never change (no action exists), no phone, no lines, no export. |
| `application/use-cases/quotes/RequestQuoteUseCase.ts` | A stub that always throws "REPOSITORY_NOT_IMPLEMENTED". Imported by nothing. | A dummy module (CLAUDE.md forbids them). Removed. |

Dealer pricing exists as a secured column (`products.dealer_price`) and is never
served publicly. There is no dealer login, so there is no safe way to show a
dealer their price on the website today.

## 2. Target journey

### (a) Walk-in bulk buyer (a shop owner, an office, a school, an event)

1. Arrives at `/bulk` from the quote page, the dealer pages, the sitemap, or a
   link sales sends on WhatsApp.
2. Sees every approved public product in one compact list, grouped by nothing
   and filterable by category and subcategory, searchable by name or model code.
   Each row: thumbnail, name, model code, list price, "In stock" or "Out of
   stock" (never a count), and a quantity box with minus and plus buttons.
3. Types quantities. A sticky bulk list shows how many lines, how many units and
   an ESTIMATED total at list price, labelled as an estimate: volume pricing is
   confirmed by the team.
4. Or pastes a list from a spreadsheet or a WhatsApp message
   (`GP-C08, 50` / `GP-C08 x50` / `GP-C08 50`). Codes are matched to products;
   any line that does not match is listed back, never silently dropped.
5. The list is saved on the device and survives a reload or a closed tab.
6. Two honest ways out:
   - **Add to basket**: for lines of 99 or fewer (the basket's per-product
     limit), through the existing cart API. Lines over 99 stay in the bulk list
     and the page says why.
   - **Request a bulk quote**: for everything. Name, business name (optional),
     phone (required), email (optional), delivery district, needed-by date
     (optional) and notes, plus every line.
7. Confirmation page: the reference (e.g. `BQ-7K3M9P`), every line, units and the
   estimate. An SMS (and an email when given) acknowledges it with the reference
   and the line count.
8. Later: `/bulk/status` shows the request's status and lines for the reference
   plus the phone number, the way `/track-order` works.

### (b) Dealer

A dealer uses the same builder. The quote form asks "Which best describes you?"
with **Existing GoldPlus dealer** as one option. The team then applies the
dealer's agreed terms when they call back. The website never shows dealer
prices: there is no dealer authentication, and CLAUDE.md forbids dealer pricing
in public APIs. `/dealers/apply` and `/dealers/dashboard` link to the builder so
an applicant can send a first stock list and an existing dealer can reorder.

A logged-in dealer portal with dealer prices is Phase 2 (section 10) and is not
built.

## 3. Data model

Migration `0153_bulk_quote_lines.sql` (additive, backward compatible; old rows
and the old `/quote-request` form keep working unchanged).

`quote_requests` gains nullable columns:

| Column | Meaning |
|---|---|
| `reference` | Buyer-facing reference `BQ-XXXXXX` (unique; NULL for older rows). Alphabet without 0/O/1/I/L so it survives being read over the phone. |
| `idempotency_key` | Client-generated key (unique). A retry of the same submission returns the same request. |
| `request_fingerprint` | SHA-256 of phone + lines. Same key with a different list is a conflict, not a replay. |
| `source` | `form` (legacy single-product form, the default) or `bulk_builder`. |
| `buyer_type` | `retail`, `wholesale`, `corporate`, `dealer`. |
| `business_name`, `delivery_district`, `needed_by` | Business details. District is canonicalised against the verified district list. |
| `line_count`, `total_units`, `estimated_total_ugx`, `priced_line_count` | Header totals, computed on the server. |
| `updated_at` | Set when the team changes the status. |

New table `quote_request_lines` (one row per product):

| Column | Meaning |
|---|---|
| `quote_request_id` | FK, cascade delete. |
| `line_no` | Order the buyer listed them in. |
| `product_id` | FK to products, `ON DELETE SET NULL` so the snapshot outlives the product. |
| `product_code`, `product_name` | Snapshot at request time. |
| `quantity` | 1 to 50,000. |
| `unit_price_ugx`, `line_total_ugx` | Public list price snapshot. NULL when the product has no listed price. |
| `availability` | `in_stock` / `out_of_stock` / `pre_order` / `unknown` at request time. |

Unique `(quote_request_id, line_no)` and `(quote_request_id, product_id)`.

For the legacy columns the bulk row stores `product_name` = "Bulk list: first
product and N more" and `quantity` = total units, so any older reader still
shows something true.

## 4. API

Public (mounted at `/quotes`):

| Method + path | Use case | Limits |
|---|---|---|
| `POST /quotes/bulk` | `SubmitBulkQuoteUseCase` | `quote-request` family (10/min per client) at the API; 5 per 10 min per visitor at the storefront. |
| `POST /quotes/lookup` | `LookupBulkQuoteUseCase` | `order-lookup` family (60/min) at the API; 20 per 10 min per visitor at the storefront. |

`POST /quotes/bulk` body: `{ idempotencyKey, customerName, businessName?, phone,
email?, buyerType, deliveryDistrict?, neededBy?, notes?, lines: [{ productId,
quantity }] }`.

Server rules:

- The client sends product ids and quantities ONLY. Names, codes, prices and
  availability are read from the catalogue on the server (approved, active,
  public products; the same read the shop uses). A client price is never read.
- 1 to 200 lines; 1 to 50,000 per line; duplicate products are merged (capped).
- Any product that is not on sale is refused by id (`PRODUCTS_UNAVAILABLE`) so the
  page can mark those lines; nothing is saved.
- Needed-by must be a real date, today or later, within a year.
- Idempotency: the same key and the same list returns the first request
  (`replayed: true`, no second SMS); the same key with a different list is `409
  IDEMPOTENCY_CONFLICT`.
- Response: reference, lines, units, estimate, priced line count.

`POST /quotes/lookup` body `{ reference, phone }`. Any mismatch (unknown
reference, wrong phone, malformed input) is the same `NOT_FOUND`, so the endpoint
does not say which references exist. Returns status, dates, lines, totals, the
business name and the district. No email, no notes, nothing internal.

Admin (mounted at `/admin/quote-requests`, `quotes.manage`, audited writes):

| Method + path | Purpose |
|---|---|
| `GET /admin/quote-requests` | Every request (legacy and bulk) with lines, totals, contact and business details. |
| `GET /admin/quote-requests/:id` | One request. |
| `GET /admin/quote-requests/lines.csv` | Every line of every bulk request as CSV (formula-safe cells). |
| `PATCH /admin/quote-requests/:id/status` | `new -> quoted or lost`, `quoted -> won, lost or expired`. Audited. |

## 5. Pages

| Page | Notes |
|---|---|
| `/bulk` | Builder. Server-rendered list of every product (progressive: rows are real HTML), client script adds filtering, steppers, paste, the saved list and both routes out. No inline scripts (the hoisted module is nonce-stamped by the middleware), no `on*=` handlers. Works at 360 px with no horizontal scroll: each row stacks, the bulk list is a sticky bar that opens a panel. 44 px targets. Live region announces list changes. |
| `/api/bulk/cart` | Same-origin POST: origin check, the visitor's own cart credential, adds each line, reports each line's outcome. |
| `/api/bulk/quote` | Same-origin POST relay to `/quotes/bulk`, bounded body, fixed upstream path. On success it keeps the reference and phone in an httpOnly cookie for one hour, so the confirmation page can show the lines without putting a phone number in a URL. |
| `/bulk/submitted` | Confirmation (noindex). |
| `/bulk/status` | Reference + phone lookup (noindex). |

Links added: `/quote-request`, `/dealers/apply` (`?buyer=wholesale`),
`/dealers/dashboard` (`?buyer=dealer`, which preselects the buyer type), the
sitemap. `/shop` was left alone (its copy is pinned by the P0 content contracts). The header "Start here" panel and
the footer are shared with the home page document and were not touched (see
section 11).

## 6. Admin

`/admin/quotes` lists every request newest first: reference, customer, phone,
business, buyer type, line count, units, estimate, district, needed-by, status.
Each row opens `/admin/quotes/[id]` with every line (code, name, quantity, unit
list price, line total, availability at request time), the notes, and a status
form. "Download lines (CSV)" streams every bulk line. Guards are unchanged:
`quotes.manage` for all of it.

## 7. Notifications

`QUOTE_REQUEST_RECEIVED` through `SendPublicFormAcknowledgementUseCase` (the one
path every public form uses: SMS first, email as the fallback, one per recipient
per hour, three per day). Data: `customerName`, `reference`, `lineCount`,
`totalUnits`. The SMS names the reference and the number of products; the email
template's copy is unchanged (data fields only). A replayed submission sends
nothing.

## 8. Edge cases

- **Product withdrawn between page load and submit**: refused by id, the page
  marks the lines "no longer on sale" and the buyer removes them.
- **Product with no listed price**: allowed; line total is blank, the estimate
  says how many lines are unpriced.
- **Out of stock**: allowed in a quote (sales can source it); the basket route
  lets the cart API decide.
- **Over 99 of a product**: not sent to the basket; stays in the list with a
  note, and the quote route takes it.
- **Basket already holds some of a product**: added only if the sum stays at or
  under 99; otherwise that line is reported.
- **Basket's 50-product limit**: the cart API refuses, the line is reported.
- **Double click / network retry**: idempotency key per submission; the key is
  kept with the list and replaced when the list or the details change.
- **Saved list from an older catalogue**: ids that are no longer listed are shown
  as "no longer on sale" with a remove button, never silently dropped.
- **Corrupt localStorage / private mode**: the list starts empty; every
  read and write is guarded.
- **No JavaScript**: the page says the builder needs JavaScript and links to
  `/quote-request`.
- **Paste**: blank lines ignored; `code, qty`, `code x qty`, `code qty`, tabs
  (spreadsheet), `qty x code`; codes match SKU or model number ignoring case,
  spaces and dashes; ambiguous codes and missing quantities are reported.
- **Abuse**: storefront per-visitor budgets plus the API family limits; the
  acknowledgement cap stops an SMS pump; lookups answer one generic NOT_FOUND.

## 9. Deployment note

Migration 0153 must be applied BEFORE the API image rolls: the schema now
declares the new `quote_requests` columns, so the existing
`/governance/quotes/request` insert and `/governance/admin/quotes` read would
reference columns that do not exist yet. Old code runs fine on the migrated
database (every new column is nullable or defaulted). Use the usual
backup, clone rehearsal, migrate, roll sequence (`scripts/migrate-prod.sh`).

## 10. Phased scope

**Built now (Phase 1 slice):** everything in sections 3 to 8.

**Not built (later phases, each needs an owner decision):**
- Dealer login and dealer price display (needs dealer accounts and a
  permissioned price read; CLAUDE.md forbids public dealer prices).
- Tiered volume pricing shown on the site (needs owner-approved tiers).
- The team sending a priced quote back through the site, and converting a won
  quote into an order.
- Saved lists across devices (needs an account link).
- Folding the single-product `/quote-request` form into lines.

## 11. Links the owner's other work must add

The header "Start here" panel (`GpNav.astro`) and the footer (`BaseLayout.astro`
and the admin-editable footer columns) are rendered into every document
including the home page, and were being edited by another change, so this slice
does not touch them. Suggested: "Buying in bulk? Build a list" -> `/bulk` in
"Start here", and a "Bulk orders" footer link (the footer columns are
admin-editable, so it can also be added from the admin without a deploy).
