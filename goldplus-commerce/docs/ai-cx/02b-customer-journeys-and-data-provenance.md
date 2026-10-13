# 02b — Customer journeys and data provenance

Each customer-visible fact: its authority, cache policy, failure behaviour and the negative test.

| Fact | Authority | Cache / freshness | On failure | Negative test |
|---|---|---|---|---|
| Product name, price, availability, image, URL | Approved catalogue read (`fetchApprovedCatalogueWithStatus`) per request; card says "today's prices" | No chat-side cache; the catalogue read has its own | "No GoldPlus product matched" + shop link | AssistantRouter.test "nothing matches"; eval #92 |
| Battery fit | Battery finder (`find_battery`) with `fitState` and `fitLabel` | Per request | Unmapped phone → "we have not matched a battery … send the model number on WhatsApp" | AssistantRouter.test ambiguous + eval #93 |
| Phone ambiguity | Finder returns `AMBIGUOUS_DEVICE` / `SUGGESTIONS` | — | One question listing the candidates | AssistantRouter.test |
| Shop address, hours, map, WhatsApp | `store_info` → `businessInfo.ts` | Per request | Business info unavailable → tool error → generic hand-over | eval #7, #37–#39 |
| Delivery terms | `store_info.delivery` + fixed sentence "fee shown at checkout" | Per request | Same | eval #5, #33–#36, #95, #96 |
| Payment methods | `storefrontCopy.payment` | Per request | Same | eval #8, #40–#42 |
| Order status | Never read; link to `/track-order` | — | — | eval #75, #76 (routed ORDER, no lookup) |
| Warranty / returns / genuine | Policy pages linked; wording says nothing is approved in chat | — | — | eval #45–#48, #80 |
| Bulk | `/bulk`, `/quote-request` | — | — | eval #17, #49, #50 |
| Delivery fee, ETA, promotion state, loyalty balance | Not available to the assistant | — | The router/model says it cannot confirm | eval #82, #94, #96 |

## Journeys (what good looks like, as implemented)

| Journey | Route | Answer shape |
|---|---|---|
| "Cheapest 64GB flash drive today?" | PRODUCT, deterministic | up to 5 cards from `search_products`, link to `/shop?q=` |
| "Battery for Tecno Spark 10" | BATTERY, deterministic | finder: one question (10 / 10C / 10 Pro) or the fits with their labels |
| "Will this charger fast-charge my phone?" | PRODUCT, model | Claude asks for the phone if needed, uses `search_products`/`get_product`, cards from tool data |
| "Deliver to Nansana today?" | DELIVERY, deterministic | delivery note, cut-off, "fee shown at checkout"; outside Kampala/Wakiso → "check on WhatsApp first" |
| "MTN deducted but pending" | PAYMENT, deterministic | the two payment methods, "we never ask for PIN/OTP", WhatsApp with the order reference |
| "Where is my order?" | ORDER, deterministic | `/track-order` + WhatsApp; nothing looked up |
| "Earbuds stopped working" | POLICY, deterministic | warranty depends on product, team checks first, links |
| "50 power banks for the office" | BULK, deterministic | bulk and quote pages |
| "I bought the wrong battery" | POLICY, deterministic | returns page + WhatsApp; no acceptance promised |
| "Something under UGX 30,000" | PRODUCT, deterministic | catalogue search on the cleaned query (price filtering is a follow-up; the cards show prices) |

## Hand-over categories → path

Unverified fit, missing policy, payment discrepancy, fulfilment problem, suspected counterfeit
(`/support/fake`), warranty dispute, angry or vulnerable customer, persistent misunderstanding,
provider unavailable: all end in the WhatsApp link (labelled "Chat on WhatsApp", opens WhatsApp,
no transcript or personal data appended) or the support/verification pages. No ticket is created
because no ticket system exists. (Superseded 2026-10-13: Goldie now hands over by email and to the Care
Desk with the whole conversation, see docs/assistant/README.md.)
