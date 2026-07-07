# Recommendation Engine V2 — Commercial, Privacy-Safe, Measurable

This is the V2 rework of the GoldPlus recommendation engine. It **extends**
the V1 domain (which was good) rather than rewriting it: all V1 functions and
tests remain intact, and V2 adds surfaces, intents, per-signal scoring,
eligibility, commercial/compatibility scoring, diversity strategy, structured
reasons + metadata, and privacy-safe identity.

## A. What V1 got right / what wasn't commercial-grade yet

Right: pure deterministic domain, normalised co-occurrence (cosine + shrinkage,
niche beats blockbuster), recency/type-weighted personalisation, public-DTO
safety. Not yet commercial: `/for-you` **trusted a public `userId` query param**
(privacy hole); purchases weren't used as personalisation seeds; product names
were `null` in reasons; trending and bestseller were the same view/cart signal;
no co-cart; co-view and co-purchase were merged as raw weighted counts; no
consent, metadata, eligibility, compatibility, or commercial scoring.

## C. Critical amendments shipped (priority order)

1. **Removed public `userId` trust** — `/for-you` now derives userId only from a
   verified session token (`Authorization: Bearer`), visitor from the `gp_vid`
   cookie, and honours consent (`gp_consent` cookie / `Sec-GPC` / `DNT`).
2. **No duplicate use case** — the product-page use case exists once (the pasted
   duplication was not present in this codebase).
3. **Purchases seed personalisation** — recent interactions now include
   purchases (strongest weight) with product names.
4. **Product names in reasons** — "Because you bought GoldPlus 20,000mAh Power Bank".
5. **Trending ≠ bestseller** — separate repo methods: `getTrendingProducts`
   (views/carts), `getBestSellingProducts` (units from paid orders),
   `getMostCartedProducts`, `getNewArrivals`.
6. **Co-cart added** — `getCoCarted` (products added-to-cart together).
7. **Signals scored separately, then blended** by surface weights.
8. **Consent/privacy controls** in the request path.
9–12. Metadata + reason codes, compatibility + commercial scoring, and the
   recommended indexes (migration `0008`).

## Module map (keep / fix / extend)

| Module | Action | Notes |
|---|---|---|
| `domain/recommendation/Recommendation.ts` | **keep** | V1 pure functions untouched (backward compatible). |
| `domain/recommendation/RecommendationTypes.ts` | **new** | surfaces, intents, signals, reason codes, contexts, metadata, diversity, merchandising. |
| `domain/recommendation/surfaceConfig.ts` | **new** | per-surface weights, windows, diversity, fallback chains, `ALGORITHM_VERSION`. |
| `domain/recommendation/RecommendationV2.ts` | **new** | signal scoring, blend, eligibility, compatibility, price bands, business score, diversity, reasons, deterministic sort. |
| `application/ports/IRecommendationReadRepository.ts` | **extend** | co-cart, bestsellers, most-carted, new-arrivals, recent-incl-purchases, cart ids, product context. |
| `use-cases/recommendation/GetProductRecommendationsUseCase.ts` | **fix+extend** | signal-separated blend, co-cart, eligibility, deterministic ranking; same `{boughtTogether, alsoViewed}` shape. |
| `use-cases/recommendation/GetPersonalizedRecommendationsUseCase.ts` | **fix+extend** | consent-aware, purchases as seeds, names + reason codes. |
| `use-cases/recommendation/GetTrendingProductsUseCase.ts` | **extend** | `strategy: trending \| bestseller \| new_arrival`. |
| `infrastructure/.../DrizzleRecommendationReadRepository.ts` | **rewrite** | time windows, co-cart, bestsellers from paid orders, names, cart ids, context. |
| `interfaces/http/routes/recommendations.ts` | **fix** | no userId query trust, consent, limit validation, `/bestsellers`, `/new-arrivals`. |

## Scoring model

- **Per signal**: `score = coCount / (√(anchorSupport·candidateSupport) + shrinkage)`,
  plus a confidence `coCount / (coCount + shrinkage)` so thin evidence is trusted less.
- **Blend**: weighted sum across signals per surface; the highest-weighted signal
  sets the reason. Bought-together weights co-purchase/co-cart; also-viewed weights co-view.
- **Business score** (`computeScoreBreakdown`): explainable components — relevance,
  confidence, recency, availability (in/low/out-of-stock), commercial (clearance/
  new-arrival/price-band fit), compatibility, campaign boost, diversity penalty →
  one `finalScore`. Deterministic tie-break: score → confidence → availability → id.
- **Eligibility**: excludes anchor, seeds, purchased-non-replenishable, in-cart,
  unpublished, dealer-only, discontinued, out-of-stock (surface-configurable),
  and merchandising `exclude` rules.
- **Compatibility**: connector/wattage/device-model overlap (0 when metadata absent).
- **Price bands** (UGX): budget ≤ 50k, mid ≤ 150k, premium; intent-aware fit
  (substitutes stay near band, upgrades one up, add-ons don't dwarf the anchor).

## API

```
GET /recommendations/products/:id      # boughtTogether + alsoViewed (backward compatible)
GET /recommendations/for-you           # personalised; userId from session only, consent-aware
GET /recommendations/trending
GET /recommendations/bestsellers
GET /recommendations/new-arrivals
```

## What's real vs. future (honest boundaries)

Real from current schema: price, price band, stock, category, new-arrival
(created_at), clearance (compare-at price), published (active + approved), units
sold (paid orders). **Future** (schema additions proposed, safe null fallback
today): `marginScore`, `conversionScore`, campaign/merchandising tables,
structured compatibility metadata (parsed best-effort from `specifications`),
event hygiene flags (is_internal/bot/source), materialised aggregate tables, and
impression/click/add-to-cart/purchase tracking events. The `RecommendationMetadata`
+ `RecommendationExperimentContext` types are defined so tracking and A/B tests
(old vs new engine, cap 2 vs 3, 14- vs 30-day half-life, etc.) can be layered on.

## Migration & indexes

Migration `0008` adds the recommended indexes: `order_items(product_id,order_id)`
and `(order_id,product_id)`, `orders(user_id,created_at)` and
`(payment_status,created_at)`, and `activity_events` co-occurrence + user-recent
composites. Future: materialised views `product_co_view_daily`,
`product_co_purchase_daily`, `product_bestseller_daily`, `recommendation_candidate_cache`.

## Tests

`tests/unit/Recommendation.test.ts` (V1, unchanged), `RecommendationV2.test.ts`
(signal scoring, surface blend, eligibility, compatibility, price bands,
business score, diversity, deterministic sort, reasons), and
`PersonalizedRecommendations.test.ts` (consent off → no history read + popular
fallback; anonymous fallback; purchase-seeded reason with product name).
