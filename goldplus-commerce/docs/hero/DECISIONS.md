# Hero slider — decisions (2026-08-07)

- **D-HERO-1 · Content is CMS-driven, DB-backed.** The 12 slides and 3 global settings live in `hero_slides` / `hero_settings` (migration 0107), edited at `/admin/hero` behind `HERO_MANAGE`. A committed JSON was rejected: "editable by a non-developer" means self-service, and the media library already existed to make uploads work.
- **D-HERO-2 · ONE source of truth in `@goldplus/shared`.** The library and validation live in the shared package; the API domain re-exports them and the storefront imports them. The boot seed, the SSR fallback and the tests cannot drift. Seed is idempotent, add-only on `slide_key` — a redeploy never overwrites an operator's edit.
- **D-HERO-3 · The `<em>` boundary is the XSS boundary.** Headlines render as raw HTML so accent words can be `<em>`. The sanitiser escapes everything and restores only bare `<em>`/`</em>` — on the API and again on render. A `<script>`, an `<em onmouseover>`, an `<img onerror>` all become inert text. Length is measured on the visible text so the tag never counts as width.
- **D-HERO-4 · Cache-safe personalisation.** The storefront is SSR behind an edge cache, so the server output is visitor-NEUTRAL — the full enabled library plus a neutral lead (flash while its sale is live, else the first slide). All selection/ranking runs in the browser after paint. The public `/hero` payload is identical for everyone, so a shared cache cannot leak one visitor's variant. The client engine still filters, caps by theme, orders by funnel, and removes the unused slides from the DOM (not display:none — screen readers and Tab must not reach them).
- **D-HERO-5 · The page h1 is decoupled from the rotation.** A stable, visually-hidden `<h1>` names the page; every rotating slide title is `<h2>`. If the h1 lived on a slide it would vanish when the engine removed that slide (flash after its sale ends), leaving no h1. Verified across default / expired / new / returning states.
- **D-HERO-6 · Guard rails run server-side.** Character limits (the layout's real widths), never fewer than one slide (fall back to the evergreen `authentic`), a dead `#`/empty CTA blanked so the button is hidden not broken, required alt text, and a past-dated flash sale flagged. A save that would break the homepage is refused with the reasons.
- **D-HERO-7 · Poppins self-hosted.** The site uses Plus Jakarta Sans; the hero mandates Poppins. Three weights are served from `/hero/fonts` (CSP `font-src 'self'`), `font-display: swap`, and the arch re-measures on `fonts.ready`.
- **D-HERO-8 · Faithful port, no dependencies.** The vanilla engine, crossfade, keyframe entrances, day/night from the device clock, scratch card, reduced-motion path, `inert` + tabindex fallback, and the arch/circuit are ported unchanged. CONFIG (show, dwell, autoplay, flashSaleEnds, cutoffHour, prizes) is injected from the CMS instead of hardcoded.
- **ASSUMPTION-HERO-A · Extras are edited as JSON in the editor.** Per-campaign data (sale end/prices, promo code, fee table, prize table, loyalty thresholds) is edited as a JSON block with per-key guidance, rather than a bespoke form per campaign shape. Revisit if marketing finds the JSON a barrier.
- **PENDING · Task 3 (personalisation extension).** Cart/order/loyalty/inventory/geo signal wiring is proposed separately before any build, per the brief. Category affinity (CTX.cats) is captured but not yet used — it is the first item in the proposal.

## 2026-08-07 — Task 3 (personalisation), and two bugs the review + a real browser caught

- **D-HERO-9 · Personalisation is a post-paint enhancement, never a deferred boot.** The engine renders and rotates IMMEDIATELY from local context; signals apply afterwards and NEVER reshuffle the visible rail (a post-paint reshuffle is worse UX than the marginal ranking gain). An earlier attempt deferred the whole engine behind the signals fetch and left the controls dead, the countdown frozen and the arch image missing for up to 700ms — the adversarial review caught it; reverted.
- **D-HERO-10 · Signals: A/B/C/E, honestly scoped.** A — category affinity swaps the arch product on product-agnostic slides and deep-links the browse CTAs; B — the cart cookie (local, functional) suppresses the first-order promo; C — the real loyalty ledger balance fills the meter for a logged-in profile; E — a sold-out flash SKU is gated. D (utm) + CMS priority blend into scoring. F (delivery zone) is honestly null: no address before checkout. Server-signal RANKING effects (hasOrdered boost) were dropped rather than reshuffle after paint.
- **D-HERO-11 · Cache-safe split.** GET /hero is visitor-neutral and short-cached; GET /hero/signals is per-visitor and `private, no-store`, resolved via the HttpOnly visit token through a same-origin relay. The edge cache can never leak one visitor's variant.
- **D-HERO-12 · Consent is honoured (§4.3).** Defaults off. No server signal fetch (no profiling) without `personalization`; no telemetry without `analytics`. The visitor's own cart cookie is read regardless (functional). A QA override cannot relax the consent gate. Proven in a real browser: no consent → 4 slides, one h1, ZERO hero network calls.
- **D-HERO-13 · Measurement has its own owner.** Per-slide impression (active ≥1s) and CTA click, by segment and position, to `hero_events` (0108) — never the recommendation contract, because the hero is not a recommendation placement. CTR is withheld below a 100-impression floor. Report on /admin/hero.
- **FINDING-HERO-A · Stored XSS (two sinks), fixed.** The injected `window.__GPHERO` config (CMS-controlled values could carry `</script>`) is now escaped at the render sink; the scratch CTA no longer builds `innerHTML` from `prize.pct` (textContent + static node). Both were confirmed blockers in the review.
- **FINDING-HERO-B · The hero rendered BLANK in production, fixed.** `.gp-hero` lost `width:100%` when the demo shell was deleted; the homepage `<main>` is a flex column and `margin:auto` disables cross-axis stretch, so the section collapsed to its padding (~56px) and the hero was an empty gap — undetected because tests asserted the DOM existed, never that the box had width. Restored `width:100%`; the production matrix now asserts real width/height + one visible h1. This had affected the deployed Tasks 1&2 hero too.

## 2026-08-07 — the hero must sit in the site's content grid, not full-bleed

- **FINDING-HERO-C · The hero juted out wider than the rest of the page.** It imposed its own `max-width:1180px` + 28px padding and spanned the full page width, while every rail and section sits in `container mx-auto px-4 lg:px-8`. Measured: at a 960 viewport the content column was x96→864 but the hero card was x28→932 — ~68px proud on each side, reading as a foreign full-width block pasted above a contained page. This is what "you just pasted the code without integrating the styling" meant, and it was right.
- **FIX.** The hero is placed INSIDE that same container (index.astro) and no longer carries its own max-width or horizontal padding (`.gp-hero{width:100%;margin:16px 0 0;padding:0}`); the container owns width and padding, so the hero's left/right edges are flush with the rails and sections. Verified in a real browser: hero-card left = recommendation-card left (both 344 at one width); hero right = the container's padded inner edge. The mobile padding overrides were zeroed for the same reason (the container's px-4 owns them). A plug-and-play port should have done this from the start.
- **NOTE · Bleed photo resolution.** The three lifestyle photos came from the provided standalone bundle at ~760px wide; the brief calls for 2000px+. They upscale softly on large screens. Higher-resolution originals should be uploaded via the media library — an asset the bundle did not contain, not a code fix.

## 2026-08-07 — personalisation was built but inert; two prior decisions revised

Self-critique after Tasks 1–3 shipped: the personalisation layer worked in a test
harness but did almost nothing for a real visitor. Two of the decisions above were
the cause, and both are revised here — recorded as supersessions, not silent edits.

- **D-HERO-14 · Personalisation runs by default; explicit refusal is honoured. (SUPERSEDES D-HERO-12.)**
  D-HERO-12 gated the signals fetch and telemetry behind opt-IN consent (`personalization`/`analytics`
  recorded true). But the consent SDK defaults every purpose to FALSE, and no storefront
  banner ever grants them — only the Preference Centre does, which a visitor has to seek out.
  Meanwhile the recommendation-event relay and the telemetry lib fire with NO consent gate at
  all, and the cookies page tells visitors "Global Privacy Control and Do Not Track are honoured
  for personalisation" — i.e. personalisation is ON unless a browser signal says otherwise. So
  D-HERO-12 made the hero the ONE self-suppressing surface, inert for ~100% of real visitors,
  inconsistent with both the rest of the site and the site's own stated posture. "Proven in a
  real browser: zero hero network calls" was true and exactly the problem — the feature never
  ran for anyone. Revised posture (`heroOptedOut`): profiling and measurement run by default,
  and an EXPLICIT refusal is honoured — Global Privacy Control, Do Not Track, or a purpose set
  false in the Preference Centre. The pre-banner deny-all default is NOT treated as a refusal
  (no banner exists to have shown it). This matches the cookies-page promise verbatim and is in
  fact stricter than the rec relays, which honour neither GPC nor DNT.
- **D-HERO-15 · Server signals now choose slides, not just cosmetics — without a visible jump. (SUPERSEDES D-HERO-10; refines D-HERO-9.)**
  D-HERO-9's "never reshuffle the visible rail" was right about the slide the visitor is LOOKING
  at, but D-HERO-10 over-applied it: the server's richest signals (hasOrdered, category affinity)
  were allowed to change only the arch image, a CTA href and the loyalty meter — never WHICH
  slides show — so a confirmed repeat customer and a first-time visitor saw the identical slide
  SELECTION. Selection is now re-runnable: `computeChoice(ctx)` picks/orders from a context and
  `applyChoice(chosen, keepVisibleId)` makes that the rail. It runs once immediately from local
  context (controls, countdown and rotation live at t=0 — D-HERO-9 preserved), then again when
  signals arrive, PRESERVING the currently-visible slide (it is force-kept in the set and stays
  active) so only the not-yet-seen deck re-ranks. Honest signal effects added: a customer who has
  ordered is not shown the first-visit welcome and gets loyalty/referral lifted; real browsing
  affinity lifts new-arrivals/range. Slides are now HIDDEN, never removed from the DOM, so a later
  choice can pick any of the twelve; `[hidden]{display:none}` (already in the stylesheet) keeps
  them off the accessibility tree and out of Tab order, honouring D-HERO-4's original intent.

## 2026-08-07 — personalisation moved server-side; consent gating removed (owner decision)

The site owner's product call: personalisation runs for EVERY visitor, decided on
the SERVER, with no consent gating. This supersedes the consent posture of D-HERO-14
and completes the server-authoritative direction hinted at in D-HERO-4.

- **D-HERO-16 · Selection, ordering and enrichment run on the server. (SUPERSEDES the client-selection half of D-HERO-4, D-HERO-9, D-HERO-15.)**
  The choice of WHICH four slides a visitor sees, their funnel order, and the
  enrichments (real loyalty balance, category deep-linked CTAs, preferred arch
  product) are computed by the API from the visitor's experience profile and
  rendered by SSR. The browser no longer selects, fetches `/hero/signals`, or
  re-selects after paint — it only reveals the server-chosen rail and rotates it.
  The selection logic is now ONE pure, unit-tested function in `@goldplus/shared`
  (`selectHeroSlides`), used by the API and by the SSR fallback, so it can no
  longer drift between a browser copy and a server copy. Endpoint:
  `GET /hero/personalised` (resolves the profile from the HttpOnly visit token;
  reads the referral flag, QA `?gp=` override and clock). Visitor tier
  (new/returning/regular) is derived server-side from profile tenure + distinct
  event-days instead of a browser localStorage counter. The flash countdown and
  same-day cutoff are evaluated in Kampala time (fixed UTC+3) from the server clock.
- **D-HERO-17 · No consent gate; the homepage is per-visitor and uncached. (SUPERSEDES D-HERO-12 and D-HERO-14.)**
  Personalisation and measurement run for every visitor unconditionally — no
  opt-in, no GPC/DNT honouring. This is safe to render per-visitor because the
  homepage is already dynamic and NOT shared-cached (it mints a per-visitor
  `gp_visit` cookie, carries no `Cache-Control`, and sits behind Caddy, not a CDN
  cache — the "edge cache" premise of D-HERO-4 never matched production). The
  personalised API response is `private, no-store` regardless. The cookies page no
  longer claims to honour GPC/DNT for personalisation (that claim would be false);
  it states plainly that the storefront is personalised first-party for every
  visitor and that data is never sold or shared. Impression/click telemetry
  (`/hero/events`) continues, also ungated — an impression still counts only when
  the slide is actually on screen (>=1s, tab visible), which is honesty about what
  was seen, not a privacy gate.
