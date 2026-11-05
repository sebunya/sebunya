# Delivery copy: production content edits (visibility gaps A6, 2026-11-05)

Code defaults are fixed on branch feat/gaps-journeys. Two saved admin records REPLACE those defaults in production,
so they still say less than the owner's promise (same-day dispatch AND delivery in Kampala and Wakiso, orders
before 5pm, Monday to Saturday). Observed with plain GETs on 2026-11-05. No migration: two fields, edited by hand.

| # | Admin path | Record / field | Current value (live) | Proposed value | Verify at |
|---|---|---|---|---|---|
| 1 | /admin/business-info | business_info, field "Delivery note" (`deliveryNote`) | `Same-day in Kampala & Wakiso. Fee shown before you pay.` | `Same-day dispatch and delivery in Kampala & Wakiso on orders before 5pm. Fee shown before you pay.` (the code default) | footer of any page, /faq, /llms.txt "Delivery:" line, MCP `store_info` |
| 2 | /admin/homepage | homepage_content, trust strip item written by migration 0188 | text `Order before 5 PM for same-day dispatch in Kampala & Wakiso` (title `Goes out today`) | text `Order before 5 PM for same-day dispatch and delivery in Kampala & Wakiso`; keep the title `Goes out today` (true) | https://shopgoldplus.com/ trust strip |

Cache: the storefront reads business info and homepage content with a short in-process cache; no purge needed beyond
waiting a few minutes. Cloudflare does not cache HTML (cf-cache-status DYNAMIC). Markdown documents are cached up to
15 minutes.

Rollback: type the previous value back into the same field.

Left as they are on purpose (true under the promise): "goes out today" countdowns in the header, hero, basket and
checkout; the PDP line "Order within ... for dispatch today (before 17:00 EAT)"; the hero headline.
