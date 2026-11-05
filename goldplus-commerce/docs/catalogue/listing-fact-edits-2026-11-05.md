# Listing fact edits, 2026-11-05 (brief WP3)

Production product descriptions are admin records (`products.short_description`, `products.long_description`).
Editing the seed files in `apps/api/src/scripts/data/` only stops a rerun bringing old wording back; the live
records need one of the two paths below. Checked against https://api.shopgoldplus.com/products on 2026-11-05.

## 1. Flash drives: "any USB port" beside a USB-A connector spec

Every drive's own spec row says `Connector: USB-A` (16/32/64/128GB also `Interface: USB 3.0 (USB-A plug)`).
A USB-A plug does not fit a USB-C-only laptop or phone.

| SKU | Field | Replace | With |
|---|---|---|---|
| GP-2GB-F, GP-4GB-F, GP-8GB-F, GP-16GB-F, GP-32GB-F, GP-64GB-F, GP-128GB-F, GP-256GB-F | Short description | `works in any USB port.` | `plugs into a USB-A port.` |
| GP-2GB-F, GP-4GB-F, GP-8GB-F, GP-256GB-F | Long description | `Plugs into any USB port on a laptop, a desktop, a car radio or a TV.` | `Plugs into a USB-A port on a laptop, a desktop, a car radio or a TV.` |

## 2. Delivery: no description edit (owner decision)

Owner 2026-11-05: the promise is same-day dispatch AND delivery in Kampala and Wakiso for orders before the
cut-off. The descriptions' `Same-day delivery in Kampala and Wakiso.` and guide 103 already say that and stay.
Delivery contract guarantee 10 forbids a point-in-time promise ("by 3pm"), not a same-day one.

The one record to change is the footer and MCP delivery note (business info, admin-editable):

| Record | Field | Replace | With |
|---|---|---|---|
| `/admin/business-info` | Delivery note | `Same-day in Kampala & Wakiso. Fee shown before you pay.` | `Same-day dispatch and delivery in Kampala & Wakiso on orders before 5pm. Fee shown before you pay.` |

## How to apply

- By hand: `/admin/products/<id>` → Listing → Short / Long description → Save (audited per edit); blog: `/admin/blog`.
- Scripted, same use case as the admin editor, one audit batch, dry run first:
  `ACTOR_USER_ID=<uuid> npx tsx src/scripts/apply-listing-fact-wording.ts` then with `APPLY=1`.
  Rules: `apps/api/src/domain/products/ListingFactWording.ts` (unit-tested, idempotent).

Rollback: the audit log keeps the previous text; reverting code alone does not change stored descriptions.
llms-full.txt, MCP `get_product`, Product JSON-LD and the PDP read the stored descriptions, so they follow
the edit after the normal page cache window.
