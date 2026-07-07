# Recommendation & Personalisation Engine

An item-to-item collaborative-filtering engine in the spirit of Amazon's,
built entirely on **real first-party signals** (`activity_events` +
`order_items`). No fabricated "best seller" labels, ratings, or scarcity.

## Why it's more than "count co-occurrences"

Naive co-occurrence counts recommend blockbusters to everyone (popular items
co-occur with everything). The engine instead uses a **normalised** score:

```
similarity = coCount / (sqrt(anchorSupport * candidateSupport) + shrinkage)
```

- Dividing by each item's overall support (a cosine/lift-style measure) means a
  niche item that is *specifically* related to the anchor beats a blockbuster
  that merely co-occurs a lot.
- A **shrinkage** term and a minimum co-count discard thin-evidence noise.
- Personalisation blends a user's interactions weighted by **type**
  (purchase > cart > view) and **recency** (exponential decay), reinforcing
  candidates that multiple signals agree on.
- **Diversity caps** stop one category filling every slot; **exclusions** drop
  already-owned / in-cart / anchor items; **cold-start** tops up from trending.

All of this lives in a pure, unit-tested domain
(`apps/api/src/domain/recommendation/Recommendation.ts`) so ranking quality is
verified without a database.

## Surfaces (public API)

```
GET /recommendations/products/:id?categoryId=&limit=   # product page
    -> { boughtTogether: Product[], alsoViewed: Product[] }
GET /recommendations/for-you?limit=                     # personalised ("Recommended for you")
    -> [{ product, reason }]     # reason e.g. "Because you viewed …"
GET /recommendations/trending?categoryId=&limit=        # homepage / cold start
    -> Product[]
```

Personalisation uses the first-party `gp_vid` visitor cookie and, for signed-in
users, the user id (passed server-side by trusted callers). Every result is a
**public** `ProductPublicDto` — unpublished products and dealer pricing are
never exposed, because IDs are resolved through the same public product read
path (`findPublicViewList`).

## Signals (read repository)

`DrizzleRecommendationReadRepository` computes, with grouped SQL:

- **Co-view**: products viewed by the same visitors as the anchor (`PRODUCT_VIEW`).
- **Co-purchase**: products sharing an order with the anchor (`order_items`).
- **Popularity**: recent `PRODUCT_VIEW`/`ADD_TO_CART`, add-to-cart weighted higher.
- **Recent interactions** & **purchased ids** per person for personalisation and exclusions.

## Testing

`tests/unit/Recommendation.test.ts` — normalisation (niche beats blockbuster),
noise filtering, type/recency weighting, anchor self-exclusion, diversity caps,
de-duplication, and cold-start blending.

## Roadmap

Precomputed nightly similarity tables (for scale), embeddings/content-based
similarity for brand-new products, and "recently viewed" strips are noted in
`docs/ROADMAP.md`.
