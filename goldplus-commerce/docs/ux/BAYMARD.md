# Baymard Institute audit of the GoldPlus storefront

Date: 2026-11-04. Method: the same as the Kaushik register (`docs/measurement/OUTCOMES.md`): each public Baymard
guideline scored against the code, with the file and line as evidence, then fixes shipped in waves. Nothing was
scored from a browser; every row names the code it was read from. Framing: GoldPlus is an own-brand accessories line
with a pan-African ambition, so a fix is judged by whether it survives a second country, not only Kampala today.

Scores: MET, PARTIAL, MISSING, N/A. Line numbers are as of commit 8ff26969.

## Checkout (`apps/web/src/pages/checkout.astro`)

| # | Guideline | Score | Evidence | Note |
|---|---|---|---|---|
| K1 | Guest checkout the default, account optional | MET | guest path; sign-in only offered | |
| K2 | Fewest form fields (Baymard median 11.8, ideal ~8) | MET | name, phone, email (optional), area, landmark | Four required fields. |
| K3 | Single "full name" field | MET | 1051 | |
| K4 | Mark required AND optional fields | PARTIAL | `FormField.astro:48` marks required with `*` only; 1166 heard-about says "(optional)" | Email is optional but unlabelled. Wave 1 fixes. |
| K5 | Explain why a phone number is needed | MET | 1053 helper text | |
| K6 | Coupon and gift-card fields behind a link | MISSING | 1273-1313 both open by default | Baymard: an open code field sends shoppers off to hunt for codes. Wave 1 fixes. |
| K7 | Inline validation (on blur), not only after submit | MISSING | `novalidate` 1021; errors arrive from the server summary | Wave 1 adds blur validation for name, phone, email. |
| K8 | Error summary that links to each field | MET | 738-741 pins the invalid field | |
| K9 | Delivery cost and date before payment | MET | live quote + cutoff line 920 | |
| K10 | Total cost shown near the pay button | MET | 1347-1349 (mobile total row) | |
| K11 | Trust and security near the pay button | MISSING | no line next to 1358 | Wave 1 adds "PesaPal's secure page; your PIN or card never reaches us" + returns link. |
| K12 | Payment methods named, logos | PARTIAL | label from admin copy, default "Pay now with Mobile Money or card" | One method only (owner decision 2026-10-16); still rendered as a radio. |
| K13 | Draft survives a dropped connection | MET | draft persistence | |
| K14 | Address entry fitted to the country (no postcodes) | MET | `UgandaLocationPicker`, landmark field | Will need per-country pickers for expansion. |
| K15 | Order cut-off as a live countdown | PARTIAL | static sentence 920 | Low priority. |

## Product page (`apps/web/src/pages/products/[slug].astro`)

| # | Guideline | Score | Evidence | Note |
|---|---|---|---|---|
| P1 | Variants (capacity, colour) selectable on one page | MET | `ProductPublicDto` has no sibling field; buy form 774-804 | Wave 3 (0218): `variant_group` on products, set on the admin properties form; `siblings` on the DTO; "Also available as" pills on the page. |
| P2 | In-scale / in-hand image | MISSING | `ProductGallery.astro:24` no image type | Content work. |
| P3 | Guest save-for-later | MET (wave 2) | `lib/guestSaved.ts`; `pages/api/saved.ts` guest branch; merged into the account at sign-in | Device cookie of product ids; `/account/saved` serves guests. |
| P4 | Per-piece price for packs | PARTIAL | bundles 827-838 no per-item price | |
| P5 | Delivery cost estimate before an area is chosen | MET | 902-915; quote only once an area is known; `subtotalUgx` passed the retail price, not the sale price | Wave 3: "Delivery from UGX …" under the price from GET /delivery/from = bottom ladder rung or the published minimum fee (CONTRACT rule 4: the quoting service's own floor). |
| P6 | Delivery date on the page | PARTIAL | `deliveryQuotePanel.ts:160-168` only when the API has a window | By design (CONTRACT rule 10). |
| P7 | Returns and warranty next to the buy button | PARTIAL | returns 919-925 MET; warranty only for batteries 1080 | Own-brand warranty term needs a source of truth: owner decision. |
| P8 | Gift options | MISSING | | Low priority. |
| P9 | Staff replies to reviews styled distinctly | MET | `lib/reviews.ts:9` no reply field | Wave 3 (0218): `staff_reply` on reviews, reply form under published reviews in Platform Modules, styled block on the page. |
| P10 | Reviewer photo gallery | PARTIAL | `?reviews=all` see-all shipped in wave 2 | A photo strip across reviews is still open. |
| P11 | Price clarity: tax, real discounts | PARTIAL | 689-717; countdown tied to a real `endsIso` | No tax statement. |
| P12 | Add-to-cart confirmation without leaving the page | MET (wave 2) | fetch submit + toast; `/cart?added=` stays the no-JavaScript path | Buy now still goes to checkout. |
| P13 | Compatibility explicit for every item | PARTIAL | 1012-1015 only when staff declared it | Non-battery items show no "works with". |
| P14 | Enough images, "in the box" | PARTIAL | gallery capped at 4 | Content + cap: wave 2. |
| P15 | Honest stock state | MET | 713-717 | |
| P16 | Compatibility-based recommendations | MET | `CompleteSetupRail.astro` | |
| P17 | Q&A complete and searchable | MET | `?questions=all` see-all shipped in wave 2 | Wave 3: a search box over the answered questions once there are more than three. |
| P18 | Contact and payment methods visible | MET | WhatsApp only when not buyable 874-879 | Wave 3: "Ask us on WhatsApp" under the buy buttons for a buyable product too. |
| P19 | Sticky buy bar, no horizontal scroll | MET (wave 2) | body padding reserved while the bar shows | |
| P20 | No layout shift | MET | eager cover with dimensions | |

## Cart, shop, search (`cart.astro`, `shop.astro`, `GpNav.astro`, `packages/shared/src/search`)

| # | Guideline | Score | Evidence | Note |
|---|---|---|---|---|
| C1 | Quantity steppers | MET | `cart.astro:640-670` | |
| C2 | Line shows image, name, unit price, remove with undo | MET | 574-687 | |
| C3 | Delivery cost in the cart total | MET | 711-718 "Not included yet" | Wave 3: the Delivery row shows the same floor, "exact at checkout". |
| C4 | Delivery date / pickup in the cart | PARTIAL | only with a known area | |
| C5 | Basket persists and says so | MET | 257-262 persists; never said | Wave 3: a sentence under the summary says the basket is kept on this device or the account. |
| C6 | Save for later from the cart | MET (wave 2) | cart line "Save for later" = keep (account or device) + remove with Undo | |
| C7 | Cross-sells below the summary | MET | 794-799 | |
| C8 | Checkout button visible on phones; "no account needed" | PARTIAL | 558/697 summary renders AFTER the list on phones | Wave 1: CTA above the list on phones + "No account needed". |
| C9 | No open coupon field in the cart | MET | 748 | |
| C10 | Payment methods shown in the cart | MISSING | trust strip 772-788 | Wave 1. |
| C11 | Unavailable lines named, not totalled | MET | 343-347 | |
| S1 | Category structure and breadcrumbs | MET | /shop has no visible breadcrumb | Wave 3: visible breadcrumb in the shop header (Home › Shop › category › subcategory). |
| S2 | Cards show a key spec and fit | PARTIAL | `ProductCard.astro` no spec unless short description set | |
| S3 | Filters by compatibility, on hub pages too | PARTIAL | facets only on /shop | |
| S4 | Relevance sort for search results | MET (wave 2) | `rankDiscoveryProducts`; "Best match" is the default order for a search | |
| S5 | Pagination keeps state | MET | | |
| S6 | Honest stock and sale chips | MET | | |
| Q1 | Exact model code search tolerant of hyphens and spaces | MET (wave 2) | hyphen-stripped sku and model number searched on both engines | |
| Q2 | Product-type queries route to the category | PARTIAL | | |
| Q3 | Feature queries ("45W", "10000mAh") | PARTIAL | `normalizeSearchWords` joins number + unit (wave 2) | Verified attribute values are still not in the searched text. |
| Q4 | Symptom queries ("charging slowly") | MISSING | | Wave 2 maps to finders. |
| Q5 | Use-case words; "car" must not match "card" | MET (wave 2) | whole-word tier in `rankDiscoveryProducts` | The card still appears, after the car charger. |
| Q6 | Compatibility queries ("Samsung A14 charger") | MISSING | `queryExpansion.ts:143` digit words never relax | Wave 1 lets model tokens relax; no-results links the finders. |
| Q7 | Unit abbreviations (mAh, W, PD) | MET | "watt"→"w", "10,000"→"10000" (wave 2) | Wave 3: "power delivery" → pd, "quick charge" → qc in `normalizeSearchWords`. |
| Q8 | Non-product queries (returns, delivery, track) route to help pages | MISSING | search covers products only | Wave 1 adds a help card for these words. |
| Q9 | Autocomplete with products and categories | PARTIAL | products only | |
| Q10 | No-results page with real next steps | PARTIAL | 446-474 | Wave 1 adds charger and product finders. |
| Q11 | Mobile search field | PARTIAL | one tap away on phones | |

## Accounts and after the order

| # | Guideline | Score | Evidence | Note |
|---|---|---|---|---|
| A1 | Account creation offered after the order, one field | MET (wave 2b) | `confirmed.astro` one-field form; `POST /account/orders/claim` (`ClaimOrderUseCase.ts`) | The order is claimed on the tracking proof (number + contact on the order), never by registration itself. |
| A2 | Simple sign-up, no confirm-password | MET | `register.astro:220` confirm password | Wave 3: one password field with show/hide; `confirmPassword` gone from the form and the validator. |
| A3 | Phone + SMS code sign-in | MET (wave 2b) | `login.astro` phone first; `POST /auth/sms-sign-in/{start,verify}` (`SmsSignInUseCases.ts`, marker `sgn:`) | Same bounds as the reset code; no enumeration; mints the ordinary session. |
| A4 | Confirmation page essentials: what happens next, delivery window | PARTIAL | `confirmed.astro:65-127` | Wave 1 adds "what happens next" from the messages we actually send. |
| A5 | First message carries a track link | PARTIAL | `CustomerMessages.ts:286` no link; FAILED/CANCELLED emails point at `/checkout` | Wave 1 fixes both. |
| A6 | Guest tracking with dated steps and rider details | MET (wave 2b) | `OrderTrackingUseCase.ts` from `order_events` + `fulfilment_dispatches`; both ladders show the date and the rider's first name | Estimated arrival shown as an estimate only. |
| A7 | Returns and warranty plain, self-service, refund timeline | PARTIAL | `returns.astro:38` no timeline; `track-order.astro:358` says "contact support before returning", contradicting `/returns/start` | Wave 1 fixes the contradiction. Refund timeline is an owner number. |
| A8 | Profile editable | MET (wave 2b) | `/account/profile`: email with password (`ChangeEmailUseCase.ts`), phone by SMS code (existing verification flow) | Names live on addresses, as checkout uses them. |
| A9 | Saved addresses reusable | MET | Edit address: wave 2. | Wave 3: name, phones and directions edited in place (PUT /account/addresses/:id); the area is re-picked as a new address. |
| A10 | Opt-out easy and honest | PARTIAL | `preferences.astro:246` says every offer choice is off until turned on; basket reminders default on | Wave 1 fixes the sentence. |
| A11 | Receipts for guests | MET (wave 2b) | `/receipt` on the tracking proof; linked from confirmation and tracking | Payment receipt, not an EFRIS invoice; paid orders only. |
| A12 | Error and empty states have a next action | MET | | |

## Waves

- Wave 1 (this PR): K4, K6, K7, K11, C8, C10, P5 sale-price bug, Q6, Q8, Q10, A4, A5, A7, A10. No migration.
- Wave 2 (PR after #269): P3/C6 guest save, P10/P17 see-all, P12 in-page add confirmation, P19 spacer, S4 relevance + Q5,
  Q1/Q3/Q7 normalisation. No migration.
- Wave 2b (PR after #270): A1 one-field account after the order that keeps the order, A3 phone + SMS-code sign-in, A6 dated
  steps + rider, A8 your-details page, A11 guest receipts. No migration (the sign-in code shares `phone_verification_codes`).
- Wave 3 (PR after #271, migration 0218): P1 variant groups, P9 staff replies, P5/C3 "Delivery from" the quoting service's
  floor, A2 one password field, A9 edit an address in place, C5 basket-kept sentence, P17 question search, P18 WhatsApp
  for buyable items, Q7 PD/QC phrases, S1 visible breadcrumb.
- Still open (content or a second data model): P2 in-scale images, P4 per-piece price for packs, P8 gift options, P10 photo
  strip across reviews, P13 "works with" for non-battery items (needs declared compatibility per item), P14 gallery cap,
  K12 payment method as a statement, K15 live cut-off countdown, S2 card spec, S3 hub filters, Q2/Q4/Q9 query routing and
  category suggestions, Q11 mobile search field, C4 cart delivery date.
- Owner decisions: warranty term for own-brand products (P7), refund timeline in days (A7), tax statement (P11).
