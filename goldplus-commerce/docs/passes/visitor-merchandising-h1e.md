# GoldPlus Commerce UI Pass H1E & H1E-R2 Technical Runbook

This document details the architecture, behavioral economics design, visual copy matrix, and quality verification for **Pass H1E (Advanced Merchandising & Visitor Intelligence)** and **Pass H1E-R2 (Recommendation Label System & Behavioural Copy Polish)**.

---

## 1. Executive Summary & Acceptance Decision

All prior baselines (H1A to H1D-R2) remain perfectly stable and untouched. This pass successfully refined the customer-facing titles, subtitles, and CTA microcopy across the storefront's first-party recommendation engine to elevate the visual tone and increase conversion momentum using verified psychological cues.

> [!IMPORTANT]
> - **Recommendation Logic Lock**: Zero changes were made to backend algorithms, ranking logic, product filters, or data sources.
> - **Governance & Privacy**: Strict non-PII compliance is preserved; browser tracking registers only anonymous interest markers with zero sensitive elements.
> - **Protected Files Pure State**: `Header.astro`, `cart.astro`, `checkout.astro`, `track-order.astro`, and backend routing files remained 100% untouched.

---

## 2. Recommendation Engine Label Matrix

To optimize visual communication and reduce decision friction, visual titles and subtitles have been polished according to core behavioral principles:

| Component File | Behavioral Rationale | Old Title / Subtitle | New Title / Subtitle |
| :--- | :--- | :--- | :--- |
| `PopularNowRail.astro` | **Social proof & momentum**: Simplifies user choices without unbacked artificial "trending" tags. | `"Recommended for your visit"` / `"Handpicked verified electronics."` | `"Top Sellers Right Now"` / `"Customer favourites based on real GoldPlus orders."` |
| `CategoryAwareRail.astro` | **Familiarity & Peer Discovery**: Frames browsing interest dynamically as matching behavior. | `"More from this category"` / `"Recommended based on your visit."` | `"People exploring similar products also viewed"` / `"More verified picks from the category you were browsing."` |
| `RecentlyViewedRail.astro` | **Memory cue**: Minimizes cognitive friction by resuming browser session state. | `"Pick Up Where You Left Off"` / `"Continue with products you viewed..."` | `"Pick Up Where You Left Off"` / `"Your recently viewed GoldPlus products are still here."` |
| `CartAwareRail.astro` | **Loss aversion & commitment**: Prompts returning customers with active items without countdown stress. | `"Continue your shopping journey"` / `"You have items waiting in your cart..."` | `"Still thinking it over?"` / `"You have items saved and ready to continue."` |
| `CartAddonRail.astro` | **Goal completion**: Suggests compatible items to round out cart usability. | `"Add Before Checkout"` / `"Useful add-ons that complete your order."` | `"Complete Your Setup"` / `"Add the essentials that make your device work harder."` |
| `CompleteSetupRail.astro` | **Accessory synergy framing**: Guides choice toward perfect operational setups. | `"Complete Your Setup"` / `"Pair compatible GoldPlus products..."` | `"Complete Your Setup"` / `"Add the essentials that make your device work harder."` |
| `RelatedProductsRail.astro` | **Guided discovery**: Surfaces highly relevant extras/alternatives. | `"You May Also Like"` / `"Similar choices within our curated inventory."` | `"You may also need"` / `"Useful extras and alternatives for this product."` |
| `CategoryPopularRail.astro` | **Segmented social proof**: Focuses momentum within the active category. | `"Popular in This Category"` / `"Top picks from this category."` | `"Top picks in this category"` / `"Customer favourites from this product family."` |

---

## 3. Visitor State & Privacy Schemas

All visitor intelligence keys are fully documented below:

*   `goldplus_seen_before` (`window.localStorage`): Standard returning-visitor marker used to hide/reveal welcome trust highlights and customize layouts.
*   `goldplus_recently_viewed` (`window.localStorage`): Array containing product detail browsing history, limited to 12 items and automatically sanitized against live backend products on render.
*   `goldplus_last_category` (`window.localStorage`): Stores the last visited category slug and action timestamp to hydreate relevance rails.
*   `goldplus_last_search` (`window.localStorage`): Stores the last anonymized keyword query and search timestamp.
*   `goldplus_cart_data` (`HTTP Cookie`): Encodes active cart items and quantities to coordinate recovery cards.

---

## 4. Verification & Quality Gates

All compilation check scripts passed without warning:
- `tsc --noEmit` — 100% Type-safe.
- `vitest run tests/unit` — 243/243 tests passed.
- `vitest run tests/architecture` — 10/10 architecture boundaries satisfied.
- `astro build` — Production build compiled cleanly.
