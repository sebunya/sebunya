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

## 3. GP-P05W: magnetic alignment is not wireless charging (brief A2)

Record: `/admin/products/59de1bd4-c67d-4261-b9a6-fde3f1472783` (SKU GP-P05W-PB). Live copy checked on
https://api.shopgoldplus.com/products/goldplus-power-bank-gp-p05w-pb and llms-full.txt, 2026-11-05.
Rule: the phone itself must support wireless charging; the magnets only hold the bank in place; a magnetic
case or ring does not add wireless charging. Wireless (15W) and wired (22.5W) stay separate. The built-in
cables are a Type-C and a Lightning plug, so they suit phones with those ports, not "any other phone".

| Field | Replace | With |
|---|---|---|
| Short description | `10000mAh power bank that snaps onto the back of a phone with a magnetic ring and charges it wirelessly at up to 15W.` | `10000mAh power bank with magnets that hold it on the back of a phone. Wireless charging up to 15W works only if the phone supports wireless charging.` |
| Long description | `No cable, no holding it in place. The GP-P05W snaps magnetically onto the back of a phone that has a magnetic ring or a magnetic case and charges it wirelessly at up to 15W while you keep using the phone. For any other phone, a Type-C cable and a Lightning cable are built into the back, with wired charging up to 22.5W.` | `The GP-P05W charges a phone wirelessly at up to 15W, but only if the phone itself supports wireless charging. The magnets just hold it in place on a phone with built-in magnets, a magnetic case or a magnetic ring; a magnetic case or ring does not make a phone wirelessly chargeable. For a phone with a Type-C or Lightning port, a Type-C cable and a Lightning cable are built into the back, with wired charging up to 22.5W.` |

The rest of each field (`Type-C and iPhone cables built in, 22.5W wired.`, `10000mAh capacity. Same-day delivery…`) stays.
The title (`…Magnetic Wireless Power Bank, 22.5W…`) is unchanged: it names the product type and the wired rating.

Owner decisions, NOT applied by the script (spec rows are maker-panel values; changing them is a listing edit):
- Spec `Output power: 22.5 W` does not say wired. Proposed name: `Wired output power` (value unchanged).
- Spec `Features: Magnetic wireless charging up to 15W` (maker's wording). Proposed value:
  `Wireless charging up to 15W (phone must support wireless charging); magnetic alignment`.
- Product-specific limits (which phones the 15W applies to, Qi/Qi2/MagSafe standard) are not in any record the
  shop holds; confirm from the maker panel before stating them.

Guide 67 (`/blog/wireless-and-magnetic-power-banks-explained`) said the same thing in one line; the draft in
`docs/content/guides/67-…md` is corrected and reaches the live post through
`ACTOR_USER_ID=<uuid> DRY_RUN=1 GUIDES_DIR=/guides npx tsx src/scripts/publish-guides.ts` (then without DRY_RUN),
or by hand in `/admin/blog`. Verify: https://shopgoldplus.com/products/goldplus-power-bank-gp-p05w-pb,
https://shopgoldplus.com/llms-full.txt (GP-P05W block) and MCP `get_product` for the same slug.

## How to apply

- By hand: `/admin/products/<id>` → Listing → Short / Long description → Save (audited per edit); blog: `/admin/blog`.
- Scripted, same use case as the admin editor, one audit batch, dry run first:
  `ACTOR_USER_ID=<uuid> npx tsx src/scripts/apply-listing-fact-wording.ts` then with `APPLY=1`.
  Rules: `apps/api/src/domain/products/ListingFactWording.ts` (unit-tested, idempotent).

Rollback: the audit log keeps the previous text; reverting code alone does not change stored descriptions.
llms-full.txt, MCP `get_product`, Product JSON-LD and the PDP read the stored descriptions, so they follow
the edit after the normal page cache window.
