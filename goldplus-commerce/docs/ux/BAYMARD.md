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
| P1 | Variants (capacity, colour) selectable on one page | MISSING | `ProductPublicDto` has no sibling field; buy form 774-804 | Each capacity is its own page. Needs a data model: wave 3. |
| P2 | In-scale / in-hand image | MISSING | `ProductGallery.astro:24` no image type | Content work. |
| P3 | Guest save-for-later | MISSING | `pages/api/saved.ts:23` redirects to login | Wave 2. |
| P4 | Per-piece price for packs | PARTIAL | bundles 827-838 no per-item price | |
| P5 | Delivery cost estimate before an area is chosen | PARTIAL | 902-915; quote only once an area is known; `subtotalUgx` passed the retail price, not the sale price | Sale-price bug fixed in wave 1. "From UGX" line needs a lowest-fee value from the quoting service (CONTRACT rule 4: no invented numbers): wave 2. |
| P6 | Delivery date on the page | PARTIAL | `deliveryQuotePanel.ts:160-168` only when the API has a window | By design (CONTRACT rule 10). |
| P7 | Returns and warranty next to the buy button | PARTIAL | returns 919-925 MET; warranty only for batteries 1080 | Own-brand warranty term needs a source of truth: owner decision. |
| P8 | Gift options | MISSING | | Low priority. |
| P9 | Staff replies to reviews styled distinctly | MISSING | `lib/reviews.ts:9` no reply field | Wave 3. |
| P10 | Reviewer photo gallery | PARTIAL | 1118 six reviews, no see-all | Wave 2. |
| P11 | Price clarity: tax, real discounts | PARTIAL | 689-717; countdown tied to a real `endsIso` | No tax statement. |
| P12 | Add-to-cart confirmation without leaving the page | PARTIAL | `cart.astro:286` full redirect | Wave 2. |
| P13 | Compatibility explicit for every item | PARTIAL | 1012-1015 only when staff declared it | Non-battery items show no "works with". |
| P14 | Enough images, "in the box" | PARTIAL | gallery capped at 4 | Content + cap: wave 2. |
| P15 | Honest stock state | MET | 713-717 | |
| P16 | Compatibility-based recommendations | MET | `CompleteSetupRail.astro` | |
| P17 | Q&A complete and searchable | PARTIAL | 1179 eight answers, no see-all | Wave 2. |
| P18 | Contact and payment methods visible | PARTIAL | WhatsApp only when not buyable 874-879 | |
| P19 | Sticky buy bar, no horizontal scroll | PARTIAL | 886-896, no bottom spacer | Wave 2. |
| P20 | No layout shift | MET | eager cover with dimensions | |

## Cart, shop, search (`cart.astro`, `shop.astro`, `GpNav.astro`, `packages/shared/src/search`)

| # | Guideline | Score | Evidence | Note |
|---|---|---|---|---|
| C1 | Quantity steppers | MET | `cart.astro:640-670` | |
| C2 | Line shows image, name, unit price, remove with undo | MET | 574-687 | |
| C3 | Delivery cost in the cart total | PARTIAL | 711-718 "Not included yet" | Needs the lowest-fee value (P5). |
| C4 | Delivery date / pickup in the cart | PARTIAL | only with a known area | |
| C5 | Basket persists and says so | PARTIAL | 257-262 persists; never said | |
| C6 | Save for later from the cart | MISSING | | With P3. |
| C7 | Cross-sells below the summary | MET | 794-799 | |
| C8 | Checkout button visible on phones; "no account needed" | PARTIAL | 558/697 summary renders AFTER the list on phones | Wave 1: CTA above the list on phones + "No account needed". |
| C9 | No open coupon field in the cart | MET | 748 | |
| C10 | Payment methods shown in the cart | MISSING | trust strip 772-788 | Wave 1. |
| C11 | Unavailable lines named, not totalled | MET | 343-347 | |
| S1 | Category structure and breadcrumbs | PARTIAL | /shop has no visible breadcrumb | |
| S2 | Cards show a key spec and fit | PARTIAL | `ProductCard.astro` no spec unless short description set | |
| S3 | Filters by compatibility, on hub pages too | PARTIAL | facets only on /shop | |
| S4 | Relevance sort for search results | PARTIAL | search uses taxonomy order | Wave 2. |
| S5 | Pagination keeps state | MET | | |
| S6 | Honest stock and sale chips | MET | | |
| Q1 | Exact model code search tolerant of hyphens and spaces | PARTIAL | `product-discovery.ts:152-158` substring only | Wave 2. |
| Q2 | Product-type queries route to the category | PARTIAL | | |
| Q3 | Feature queries ("45W", "10000mAh") | PARTIAL | attributes not searched | Wave 2. |
| Q4 | Symptom queries ("charging slowly") | MISSING | | Wave 2 maps to finders. |
| Q5 | Use-case words; "car" must not match "card" | PARTIAL | `search/index.ts:11-13` | A ranking problem (whole-word hits must outrank substring hits), so it ships with S4 in wave 2; a boundary rule alone would break "ear" finding earbuds. |
| Q6 | Compatibility queries ("Samsung A14 charger") | MISSING | `queryExpansion.ts:143` digit words never relax | Wave 1 lets model tokens relax; no-results links the finders. |
| Q7 | Unit abbreviations (mAh, W, PD) | PARTIAL | | Wave 2. |
| Q8 | Non-product queries (returns, delivery, track) route to help pages | MISSING | search covers products only | Wave 1 adds a help card for these words. |
| Q9 | Autocomplete with products and categories | PARTIAL | products only | |
| Q10 | No-results page with real next steps | PARTIAL | 446-474 | Wave 1 adds charger and product finders. |
| Q11 | Mobile search field | PARTIAL | one tap away on phones | |

## Accounts and after the order

| # | Guideline | Score | Evidence | Note |
|---|---|---|---|---|
| A1 | Account creation offered after the order, one field | PARTIAL | `confirmed.astro:129-135` links to the full register form | Wave 2: inline password field that keeps the order (needs a sealed-receipt exception to `RegisterCustomerUseCase.ts:20`). |
| A2 | Simple sign-up, no confirm-password | PARTIAL | `register.astro:220` confirm password | Wave 2. |
| A3 | Phone + SMS code sign-in | MISSING | SMS only for password reset | Wave 2; the code plumbing exists. |
| A4 | Confirmation page essentials: what happens next, delivery window | PARTIAL | `confirmed.astro:65-127` | Wave 1 adds "what happens next" from the messages we actually send. |
| A5 | First message carries a track link | PARTIAL | `CustomerMessages.ts:286` no link; FAILED/CANCELLED emails point at `/checkout` | Wave 1 fixes both. |
| A6 | Guest tracking with dated steps and rider details | PARTIAL | `track-order.astro:240-260` no dates per step | Wave 2. |
| A7 | Returns and warranty plain, self-service, refund timeline | PARTIAL | `returns.astro:38` no timeline; `track-order.astro:358` says "contact support before returning", contradicting `/returns/start` | Wave 1 fixes the contradiction. Refund timeline is an owner number. |
| A8 | Profile editable | PARTIAL | no page edits name, email or phone | Wave 2. |
| A9 | Saved addresses reusable | MET | | Edit address: wave 2. |
| A10 | Opt-out easy and honest | PARTIAL | `preferences.astro:246` says every offer choice is off until turned on; basket reminders default on | Wave 1 fixes the sentence. |
| A11 | Receipts for guests | PARTIAL | signed-in paid orders only | Wave 2. |
| A12 | Error and empty states have a next action | MET | | |

## Waves

- Wave 1 (this PR): K4, K6, K7, K11, C8, C10, P5 sale-price bug, Q6, Q8, Q10, A4, A5, A7, A10. No migration.
- Wave 2: P3/C6 guest save, P10/P17 see-all, P12 in-page add confirmation, P19 spacer, S4 relevance + Q5, Q1/Q3/Q7
  normalisation, A1 one-field account after the order, A3 phone sign-in, A6 dated steps, A8 profile edit, A11 guest receipts.
- Wave 3 (data model): P1 variants, P9 staff replies, P13 "works with" for every item, lowest delivery fee for P5/C3.
- Owner decisions: warranty term for own-brand products (P7), refund timeline in days (A7), tax statement (P11).
