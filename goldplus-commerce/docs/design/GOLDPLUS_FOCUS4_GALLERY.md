# GoldPlus product gallery — design (Focus 4)

## Principle

Photography dominates, controls stay quiet, buying stays obvious. One focused image; every other available image is a preview the shopper can choose. Selecting an image changes nothing but what the shopper is looking at.

Reference synthesis (from the brief's evidence register): Master & Dynamic's product scale, Teenage Engineering's simple previous/next, Keychron's discoverable previews, expressed with GoldPlus's own tokens. B&O is a restraint reference only; Dyson a content reference (show what is included). Nothing is cloned.

## Tokens (repository truth, not the brief's assumptions)

| Token | Value | Where |
|---|---|---|
| Accent green | `#93D500` (`brand.primary`) — surfaces, focus rings, spinner; never as text on white | `apps/web/tailwind.config.mjs` |
| Green text on light | `#456B00` (`brand.primaryInk`, 5.46:1) | same |
| Ink | `#0A0A0A` (`brand.black`), `#1C1C1C` (charcoal), `#6B6B6B` (muted) | same |
| Lines / soft | `#E5E5E5`, `#F7F7F7` | same |
| Type | Plus Jakarta Sans, self-hosted, loaded after first paint with a metric-matched fallback | `public/fonts/faces.css` |
| Radius | cards `rounded-2xl`, previews `rounded-xl`, buttons pill | existing convention |
| Focus | 4 px ring at 30 % green, `focus-visible` only | existing convention |

## Layout

- **Desktop (≥1024 px):** two columns inside the existing `container mx-auto px-4 lg:px-8`; media `calc(56% − 1.75rem)`, decision column `calc(44% − 1.75rem)`, gap 3.5 rem, so the pair never exceeds 100 %. The stage is a reserved square (`aspect-ratio: 1/1`, `object-fit: contain`, `width/height` attributes) so an image can never shift layout.
- **Below 1024 px:** one column, media first, near-full width (16 px gutters), normal vertical scroll.
- **Previews:** 64 px squares on phones, 76 px from 640 px, 84 px from 1024 px; each is a 44 px+ target; no empty placeholders — only real images render.
- **Controls:** a single row under the stage: previous · `n / N` · next. Arrows are disabled at the ends; nothing wraps; nothing auto-advances (the hero's hard-won rule: never rotate on a timer).
- **1920 px:** the container caps the stage at about 700 px, so a wide screen never becomes an empty canvas.

## Purchase hierarchy (decision column, top to bottom)

1. Category eyebrow, product title (wraps naturally), model chip.
2. Price (dominant), sale price and honest saving when the price actually drops, availability, points.
3. Battery fit status for the shopper's phone where a battery is essential.
4. One concise summary sentence and at most three key facts.
5. Delivery estimate (stage 1) and the buying actions: **Add to cart**, **Buy now** (unchanged form, validation and progressive-enhancement fallback).
6. Out-of-stock: the WhatsApp ask-us line.
7. **Then** the full description, remaining benefits, and the complete specification table (unchanged table semantics).
8. Battery finder / "see what works with this".

Acceptance target: on the GP03BT fixture at 1440×900 the primary action is visible without scrolling once the page settles; at 390×844 it precedes the description and specification table with no decorative section between. Baseline positions were 1700 px and 2235 px (`docs/media/evidence/baseline-2026-09-21`). Measured results belong in `FOCUS4_RELEASE_REPORT.md`; this document states the intent.

## Four frames, four questions

| Slot | Name | Answers | Reject |
|---|---|---|---|
| 1 | Cover / Main | What exactly am I buying? | wrong model/colour, tiny subject, promo poster as default |
| 2 | Alternate | What cannot I see from the cover? | a near-identical crop |
| 3 | Detail | Will this fit or work for me? | imagery implying an unverified feature |
| 4 | Context / Contents | How big is it, what is included? | props that imply accessories |

GP03BT shot list (a request, not a claim that files exist): earbuds and case isolated; case open; the charging port or a control; the actual box contents or an honest scale reference.

## Interaction contract (implemented in `apps/web/src/lib/productGalleryState.ts`)

- Newest intent wins. Requesting the displayed image is a no-op only when nothing else is pending; if B is pending and A (displayed) is requested, B's load is invalidated and A stays.
- Only the latest still-relevant load commits; image, alt, counter, previews and arrow states commit together after decode.
- A failed large image keeps the previous image, keeps the item in the list (count unchanged) and shows one "Try again" line. A failed thumbnail becomes a labelled control; its full image stays selectable. Only authoritative unavailability removes an item, announcing the new count once.
- Keyboard: Left/Right, Home/End while focus is inside the gallery; Space activates a focused preview without scrolling the page. Modified clicks and middle clicks keep the native link.
- The disappearing-preview problem: when a keyboard-activated preview commits and therefore leaves the row, focus moves to the stable controls region **only if it still sits on that preview**; a shopper who tabbed on is never pulled back. Pointer activation never steals focus.
- Swipe: deliberate horizontal intent (≥48 px and 1.5× the vertical travel), single touch, passive listeners, no global `preventDefault`; pinch and vertical scroll are untouched.
- One polite status announcement per successful navigation ("Image 2 of 3"); none on hydration.
- Reduced motion: the pending spinner stops animating; there are no other animations.
- No JS: the cover renders, previews are ordinary links to the optimized large image, the arrows are hidden (never inert controls), buying works as before.
- Rollback: `PRODUCT_GALLERY_ENRICHMENT=false` renders the cover only.

## Not in this design

Sticky purchase bar, zoom/lightbox, video, 3D, bundles, a new cross-sell layout, analytics events (deferred: the telemetry vocabulary is shared with measurement and was left untouched).
