# GoldPlus — Final Launch UI/UX Finishing Pass (2026-09-13)

Surgical product polish with zero performance regression. Scope: the live
storefront at shopgoldplus.com, inspected before anything was edited.

## 1. Inspection performed (before any change)

| Class | Widths | Pages captured |
| --- | --- | --- |
| Small phones | 360, 390, 430 | Home, Shop/PLP, Category, Search, No results, PDP, Cart, Empty cart, Checkout, Login, Battery finder, Delivery, Support, Mobile menu |
| Tablet | 820 | Home, Shop, PDP, Checkout |
| Laptop | 1366 | Shop, PDP, Cart |
| Desktop | 1440, 1920 | Home, Shop, Search, No results, Login, Battery finder, Empty cart, PDP, Cart, Checkout |

Evidence: 57 full-page captures and 71 viewport-height segments
(`scratchpad/ui/before`, `scratchpad/ui/chunks`; the capture script is
`compatibility-audit/scripts/_chunks.mjs`, uncommitted, target the live site,
Chromium at device scale 1). Nothing was submitted; the cart was populated
with one add-to-cart and the checkout was opened but never placed.

Overall finding: the site is close to finished. Spacing, alignment, hierarchy,
buttons, forms, header, footer, empty states, cart and checkout are
consistent and deliberate at every width. The defects below are the residue.

## 2. Punch list

| # | Page / component | Observation | Why it looks unfinished | Impact | Minimum fix | Risk | Priority | Decision |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | PDP · below the fold | ~290 px of empty space between "See what works with this" and the first rail, at every width (desktop and mobile) | The complete-setup rail rendered nothing for most products, but the page still drew its divider wrapper (`border-t pt-10`) plus the `space-y-16` gap, on top of `mt-24` and the next rail's `my-12` | A dead void on the primary conversion page; reads as a broken or missing block | The rail owns its divider and renders nothing when empty; the page-level wrapper is removed | Low (HTML only, one component + one page) | P1 | FIXED |
| 2 | PDP · recommendation rails | Two consecutive rails both headed "Browse available products" (related-rail fallback, then shelf rail), first often holding a single card | The related rail's non-evidence fallback title collided with the shelf rail title chosen for the PDP | Duplicate headings read as a rendering bug and dilute both rails | Fallback heading becomes "More from the shop" (subtitle unchanged, still honest) | Low; tests that pin the approved rail labels still pass (the PDP keeps "Browse available products") | P1 | FIXED |
| 3 | PDP · product image placeholder | "No photo of this one yet." as bare text centred in a large white square; the card placeholder on the same site shows an icon plus label | Two different placeholder treatments for the same state | Every product without a photo (161 of 184) opens on what looks like a failed image | Reuse the card's icon + label treatment inside the existing container; copy unchanged | Low | P2 | FIXED |
| 4 | Shop · results header | Sort control shown beside "0 matching products" | A control with nothing to act on | Minor, but a dead control on the no-results state | Render the sort label only when there are results | Low | P2 | FIXED |
| 5 | PDP · breadcrumb at 360–390 | "Power Devices" wraps mid-label into two lines beneath the separator | Crumb links allow wrapping; only the last crumb truncates | Untidy first line of the PDP on every phone | `whitespace-nowrap` on the crumb links (the current-page crumb keeps its truncation) | Low | P2 | FIXED |
| 6 | Shop · mobile grid | One product per row at 360–430 with a full-width placeholder square; 24 products make a 17,000 px page | Deliberate: the card is designed at full width (two action buttons, two-line title); rails elsewhere use two columns with wrapped buttons | Long scroll on the primary browse page | Owner decision: a two-column mobile PLP needs a compact card variant, which is a design change, not polish | Medium (touches the card used on 12 surfaces) | P3 | NOT CHANGED — reported |
| 7 | Cart · line thumbnail placeholder | Diagonal-hatch box, a third placeholder style | Inconsistent with card and PDP placeholders | Cosmetic, 96 px thumbnail | Reuse the icon treatment | Low | P3 | NOT CHANGED — below the change budget's value bar |
| 8 | Checkout · delivery location input | Placeholder text truncates on phones ("Type your area, town or district, e.…") | Placeholder longer than the field at 360–390 | None functionally; the helper text above carries the same guidance | Would need a copy change to the placeholder | Low | P3 | NOT CHANGED — copy is not misleading |
| 9 | Header vs body typography | Nav/hero use Poppins, the rest Plus Jakarta Sans | Brand decision (hero and header are frozen) | None | No change (no font or weight changes permitted) | — | Info | NOT CHANGED |
| 10 | PDP · related rail with a single card | The related rail can serve exactly one fallback card | Engine ladder result, not markup | Slightly sparse rail | Engine owner: minimum candidate count for the fallback source | — | Info | REPORTED to the recommendations owner |

Change budget used: 5 of the permitted 5–20. Files touched: 4
(`apps/web/src/pages/products/[slug].astro`, `apps/web/src/pages/shop.astro`,
`apps/web/src/components/recommendations/CompleteSetupRail.astro`,
`apps/web/src/components/recommendations/RelatedProductsRail.astro`).
No JavaScript added or altered, no dependency, no font, no weight, no effect,
no third party, hero untouched, no new feature. One heading copy change,
justified by duplication (item 2).

## 3. Verification

- Typecheck: `pnpm typecheck` clean (shared, api, web).
- Unit + architecture: 7,836 passed; the 12 failures are the Slice09
  dirty-tree scope guards that fail on any uncommitted tree and pass once the
  work is committed (re-run after commit recorded below).
- Build: `astro build` completed.
- Commits, all deployed with `scripts/deploy-prod.sh <sha> web`:
  45ec21d4 (the five fixes, plus 58bf593d, which had been pushed but not rolled),
  5695d50c (after-screenshots still showed ~180 px of stacked padding above the
  first rail; the divider wrappers keep only the hairline), da324b7d (performance
  follow-up, §4), 54fec22e (contract test), 6d35aabe (the fallback rail heading
  "More from the shop" repeated its subtitle; now "Also in the shop"),
  41575ecf (audit tooling, §5), 942e6daf (desktop header under the scrim, §5).
- After-screenshots: `scratchpad/ui/after` (71 segments, same script and widths).
  The PDP rails now start one divider below the buy buttons at 390 and 1440; the
  no-results page has no sort control; the placeholder matches the card.

## 4. Owner's third-party results (2026-09-13) — what was application-owned

The owner sent PageSpeed Insights, WebPageTest, SpeedVitals, GTmetrix, DebugBear,
Yellow Lab, Pingdom and HTTP Observatory results ("not yet good"). Read together:

| Cause | Evidence | Owner | Action |
| --- | --- | --- | --- |
| Cloudflare JavaScript Detections | SpeedVitals TBT 628 ms, 501 ms from `cdn-cgi/challenge-platform/scripts/jsd/main.js`; DebugBear mobile 75–83 with CLS 0 and LCP ≤1.9 s | Cloudflare setting | Owner: Security → Bots → JavaScript Detections OFF |
| Rocket Loader | WebPageTest console: modulepreload for `_astro/hoisted.*.js` unused; scripts re-downloaded | Cloudflare setting | Owner: Speed → Optimization → Rocket Loader OFF |
| 630 ms TTFB from US locations | GTmetrix/WebPageTest/SpeedVitals | Distance to origin | Origin renders `/` in 60–140 ms (measured on the host); not code |
| Product thumbnails fetched the 1024 px master | DebugBear "avoid unnecessarily large images" on 14/14 pages; PSI image delivery 210–358 KiB | Application | FIXED da324b7d: rail, home pick and nav featured images use the thumb/card srcset |
| Nav icons shipped at 1024/2048 px for a 34 px box | 63 KB for two icons | Application | FIXED da324b7d: regenerated at 102 px (1.6 KB total) |
| Catalogue ids stamped twice per page | `data-valid-ids` 8.6 KB on every page | Application | FIXED da324b7d: derived from the live-product map |
| Listing first row lazy-loaded | DebugBear "don't lazy load LCP images" | Application | FIXED da324b7d: first four cards eager + fetchpriority high (inert while those products have no photo) |
| Home mobile CLS 0.08–0.10, intermittent | SpeedVitals: `gp-hero__copy`; golden master samples 0.001 / 0.098 / 0 | Frozen hero | Not changed (hero frozen); reported |
| CSP `unsafe-inline` (Observatory B+) | −20 | Security posture | Not a UI/UX change; out of scope; recorded |
| 8 web fonts (Yellow Lab C) | 3 Poppins (hero/nav) + 5 Plus Jakarta Sans, all used | Brand | No font changes permitted; reported |

Full mapping for the owner: `docs/hardening/cloudflare-lighthouse-owner-settings.md`.

## 5. Performance lock — result

Run 20260913T134226Z (`post-ui-polish-da324b7d`), 3 Lighthouse runs per cell,
against golden master 20260913T080736Z:

| Cell | Score golden → now | LCP ms golden → now | TBT ms golden → now | Bytes golden → now |
| --- | --- | --- | --- | --- |
| home / mobile | 93 → 92 | 2533 → 2518 | 167 → 9 | 366,139 → 306,506 (IMPROVEMENT) |
| home / desktop | 100 → 100 | 700 → 665 | 0 → 0 | 367,374 → 345,163 |
| shop / mobile | 99 → 98 | 1856 → 1951 | 0 → 0 | 225,656 → 235,996 |
| shop / desktop | 100 → 100 | 552 → 602 | 0 → 0 | 275,789 → 275,244 |

Comparer verdict: `WARNING_CLOUDFLARE`. Two cells moved beyond the band, both while
Cloudflare's injected-script count differed between runs (first sample of every
cell carried 8 injected requests, the others 4). The home-mobile CLS "movement"
was checked by hand: the golden master's own samples were 0.001, 0.098 and 0; today's
0, 0.103 and 0.082. Same intermittent hero shift, not a regression.

Self-critique findings in the tooling, fixed in 41575ecf: the smoke's network step
overwrote the journey results file, so the run's headline read "0 journey tests
passed" while 58 passed and 1 failed (Firefox desktop, discovery journey). A
previous commit message had claimed this exact fix; it had not been made. The five
edge-pass failures were correctly classified as blocked by the Cloudflare
challenge (10 edge-blocked records, 16 challenge responses), not defects.

With the results file fixed, the next smoke (41575ecf) showed the hidden failure:
**P0, desktop header unclickable while a mega menu is open.** The scrim is fixed,
full-screen, z-index 58 inside the header's stacking context; the top row, bar and
category rail had no level, so they painted under it. Hovering "Power" opens the
panel, and clicking "Power", the search box or the logo only closed the menu.
Reproduced on the live site in desktop Chromium, so every desktop browser was
affected; Firefox caught it only because it is the smoke's one desktop project.
Pre-existing, not introduced by this pass. Fixed in 942e6daf (CSS only: rows
above the scrim, bar above the rail so its pop-overs still cover the panel);
verified by injecting the rule into the live page (pointer reaches link, input and
panel; search sheet paints over the panel; Power navigates to its category), then
by the post-deploy smoke: **44 journey tests passed, 0 failed, P0 0** across
Chromium low-end, Chromium mainstream, Firefox desktop and WebKit iPhone.

### Final lock on the final build (942e6daf, run 20260913T144038Z)

| Cell | Golden | da324b7d | 942e6daf (final) | Final samples | Home/shop bytes golden → final |
| --- | --- | --- | --- | --- | --- |
| home / mobile | 93 | 92 | 90 | 90, 76, 94 | 366,139 → 306,548 (−16 %) |
| home / desktop | 100 | 100 | 99 | 99, 100, 99 | 367,374 → 345,099 |
| shop / mobile | 99 | 98 | 96 | 91, 96, 97 | 225,656 → 236,078 |
| shop / desktop | 100 | 100 | 100 | 100, 100, 100 | 275,789 → 275,279 |

Comparer verdict: `WARNING_CLOUDFLARE` ("baseline preserved; movement attributable to
Cloudflare-injected scripts"). Not accepted on the label alone:

- The golden master's samples carried no Cloudflare-injected scripts; every final
  sample carried 4–8 (Rocket Loader and JavaScript Detections).
- Like-for-like, with the same edge state, da324b7d → 942e6daf is flat: scores 92 → 90
  and 98 → 96 inside a spread of 76–94, bytes equal to within 42 B. The only change
  between them is a z-index rule.
- Noise dominates: one home-mobile sample scored 76 with 808 ms of blocking time at
  the same injected-script count as the 94.
- Page weight fell 16 % on home mobile; main-thread time fell on home desktop.

Conclusion: no application regression. The mobile gap to the golden master is the
Cloudflare state the owner controls (see §4), not this pass.

**UI/UX POLISH COMPLETE — PERFORMANCE GOLDEN MASTER PRESERVED**

## 6. Self red-team (§48)

- *Did a shared change break another surface?* ProductCard gained an optional
  prop defaulting to the old behaviour; only /shop and the hub pages pass it.
  RecentlyViewedRail's id filter keeps its "no catalogue ⇒ no filter" fallback.
  Typecheck, build and 7,838 unit/architecture tests pass (the Slice09 guards
  fail only on an uncommitted tree).
- *Could `eager` hurt?* Four images at most, only on listing pages, and only when
  those products have photos; mobile shows one card in the first viewport.
- *Was any copy changed?* One rail heading, twice: the first change removed a
  duplicate heading and created a repetition with the subtitle, which the second
  fixed. Both are recorded.
- *Why did earlier programme runs pass this journey?* In engines that report
  hover, the first click on "Power" navigates before the panel opens. Firefox
  headless reports no hover, so its first click opens the panel (recorded as
  `rail_needed_second_click`, a real behaviour); the second click is the one that
  landed on the scrim. Earlier runs took the one-click path; this run took the
  two-click path, and the overwritten results file hid it from the headline.
  The test's steps are legitimate; nothing in it masked the bug.
- *Were claims verified?* Every "fixed" item was checked on the live site
  (headless Chromium through Cloudflare) after deploy; the one claim that turned
  out false (the results-file fix) is called out above.

## 7. Home mobile toward 100 (owner request, evening 2026-09-13)

Method: Lighthouse 13.4.1 (the PageSpeed Insights version) on a local bench serving
the origin's own HTML (fetched on the host behind Cloudflare, so Cloudflare's
injected scripts are absent) with cached assets and brotli; A/B variants
alternated to share machine noise; Lighthouse traces read directly for layout
shifts. Then live runs.

Findings and fixes:

| Finding | Evidence | Fix | Commit |
| --- | --- | --- | --- |
| Hero copy rewrapped when Poppins arrived (CLS 0.006–0.26, timing-dependent) | trace: `.gp-hero__copy` 207 → 227 px, cause "Web font loaded" | metric-matched local fallback `Poppins Fallback` (Arial / Liberation Sans / Arimo, overrides computed from the shipped woff2) | addc5486 |
| Wordmark PNG 7.3 KB at high priority | request timeline | WebP 105/160/320 px via srcset (near-lossless; lossless and AVIF were larger for this transparent mark) | addc5486 |
| Hidden hero slides' photos eager beside the lead | request timeline | lazy until `load`, then switched to eager before the first rotation | addc5486 |
| Lead hero photo (the LCP element) 22.2 KB WebP | LCP element + request timeline | AVIF q50 (10.9 KB), checked side by side at 2× zoom; `<source type=image/avif>` first, preload `type=image/avif` | d5e00ae2 |
| AVIF served as application/octet-stream | response headers | Caddy names `image/avif` | 9efe0d7a |
| Three AVIF URLs cached at the edge with the wrong type; no purge token on the host | `cf-cache-status: HIT`, octet-stream | content-hashed output names in the optimiser | c02f18b2 |

Image optimisation module: `scripts/images/optimise-static-images.mjs` +
`apps/web/static-images.config.json` (`pnpm images:optimise`, `pnpm images:check`,
`tests/unit/StaticImageBudget.test.ts`). WebP and AVIF generation with the API's
sharp, `{w}`/`{hash}` output names, per-directory budgets for every raster in
`apps/web/public` with a dependency-free header reader. Uploaded media keeps its
own rendition pipeline in the API.

Live home mobile after d5e00ae2 (3 runs, Lighthouse 13.4.1 from an ordinary Chrome):
FCP 1.33–1.38 s, LCP 1.38–1.51 s, CLS 0.001 on every run (earlier the same day:
LCP 2.1–5.2 s, CLS up to 0.097). Scores 85 / 81 / 72, with total blocking time
542–2,033 ms coming from Cloudflare's `challenge-platform/scripts/jsd/main.js`
(JavaScript Detections) in every run; the application's own scripts under
100 ms. Bench with Cloudflare's scripts absent: home 97–100, shop 100, product 99–100.

**Correction to an earlier statement.** The nav `brand` block (`logoSrc`, alt, href)
is not read by the storefront, but it is also not editable in the admin (the nav
admin page has no brand fields): it is unused default configuration, not an
"admin saves it, the site ignores it" defect. No change made.

### 7b. Owner PSI at 98 — the document crossed a slow-4G round trip (1e076c69)

PageSpeed Insights mobile (owner, 20:25 EAT): 98 — FCP 1.8 s, LCP 2.2 s, TBT 0, CLS 0.007.
Lighthouse's simulated TCP (`TCPConnection.js`, rtt 150 ms, 1.6 Mbps) delivers 14.6 KB with
the first byte and 29.2 KB per round trip; the edge-compressed home document plus headers
was ~49 KB (two extra round trips, 43.8 KB is the one-round limit). The largest removable
block was `data-live-products` (the whole catalogue for the recently-viewed rail, ~5 KB
compressed, on every page, although that rail renders only for returning visitors with
history or on the product page). It now comes from `/api/catalogue-live` when the rail
renders; pricing logic untouched; verified live (rail renders with the live price on the
product page and for a returning visitor on home). Document after: 40.0 KB body + 2.0 KB
headers; PSI's own dependency tree shows 40.92 KiB.

Rejected after measurement: `content-visibility:auto` below the hero (paint −60 % but
style/layout and score variance worse); stripping per-page Tailwind utilities (~34 KB raw
unused on home) because client-built rails use class names from JS.

### 7c. All tools after 1e076c69 (21:08–21:40 EAT)

| Tool | Result | Notes |
| --- | --- | --- |
| PageSpeed Insights mobile | 94 (FCP 1.9 s, LCP 2.2 s, TBT 0, CLS ~0) | owner's run an hour earlier: 98; PSI varies ±3 per run |
| PageSpeed Insights desktop | **100** (FCP 0.5 s, LCP 0.5 s, TBT 0, CLS 0, SI 0.7 s) | |
| SpeedVitals mobile (US) | 87 (was 84): LCP 1.6 s (1.8), FCP 1.3 s, CLS 0.001 (0.015), TBT 512 ms | 481 ms of the TBT is Cloudflare `challenge-platform/scripts/jsd/main.js`; application ~31 ms |
| DebugBear, 14 pages | average 84; mobile 74–84, desktop 85–93 | all 14 fired at once while the full server audit ran (server CPU contention): "reduce server response time" 7 pages; "avoid unnecessarily large images" 0 % → 86 % passing |
| Server audit `all-tools-1e076c69` | Lighthouse 3-run: home mobile 95 (80/95/97), desktop 100/100/100, shop mobile 99, shop desktop 100; compatibility 44/44 journeys, P0 0; k6 canary pass; Observatory B+ | Yellow Lab 429 (public API fair-use limit) |
| GTmetrix, WebPageTest | not run | the browser extension has no permission on those domains; the audit system has no API keys |
| Pingdom | not run | the free test would not start after three attempts (likely a bot check); not pursued |

Residual layout shift: desktop hero copy settles 11 px when Poppins arrives (0.0014,
fallback tuned for phone widths); a 0.0368 section shift appears only in the server's
Linux Chromium container and not in Chrome on macOS or in PSI.

**Where 100 stands.** Page code: the bench (origin HTML, no Cloudflare scripts) scores
97–100 on home mobile and 100 on shop and product; desktop is 100. The live remainder is
(1) Cloudflare JavaScript Detections and Rocket Loader, visible to every tool that is not a
verified bot (≈480–650 ms TBT per run), an owner setting that is also a bot-protection
control; and (2) PSI run-to-run variance of a few points on FCP/LCP at the 1.8–2.2 s level.

### 7d. Fonts after first paint (c3a943b8, 2b836549) — and what 100 needs

Bisecting the live build's HTML on the Lighthouse 13.4.1 bench found the remaining
application cost: Lantern's pessimistic FCP/LCP graphs include every request started
before the observed first paint, and the inline CSS started all eight brand font files
(~88 KB) with the document. Moving the eight `@font-face` rules to `/fonts/faces.css`,
loaded on the first `paint` entry, with the metric-matched fallbacks kept inline:
bench FCP 1.21–1.37 s → 1.06 s, LCP 1.37–1.68 s → 1.38–1.40 s, CLS 0.001 → 0.000
(origin HTML: 100/100/100/99/99). Live check: all brand fonts load, CLS 0.0007 mobile /
0.0016 desktop, no console errors. Rocket Loader had rewritten the inline loader to run
after `load`; `data-cfasync="false"` exempts it.

PSI mobile, live: before 94 and 98 (FCP 1.9/1.8 s, LCP 2.2 s, SI 2.0 s); after 98 and 96
(FCP 1.7/2.0 s, LCP 1.8/2.3 s, SI 3.2/3.3 s). Lantern's speed index is
1.4 × observed SI + 0.4 × layout-weighted SI, and a later font swap raises both, so SI
rose while LCP (25 % weight) fell. Modelled with Lighthouse's log-normal curves the two
states are within noise of each other (≈97.5 before, ≈96–98 after); kept for the LCP gain.

What a steady 100 needs on PSI mobile (same curves): FCP ≲ 1.4 s and LCP ≲ 1.5 s. PSI
measures ~0.6 s more than the origin bench because of the TLS handshake and real edge
latency, and because Cloudflare adds requests before first paint (Rocket Loader,
the Web Analytics beacon, speculation). The code-side levers found in this session are
all applied; the remaining ones are the Cloudflare settings (Rocket Loader OFF, Web
Analytics beacon OFF; JavaScript Detections OFF for non-bot tools).

### 7e. Owner-instructed Cloudflare changes and the last code fixes (2026-09-14)

Cloudflare (dashboard, owner's instruction "fix the cloudflare settings … to get us to 100 everywhere"):
- Speed → Rocket Loader: **OFF** (verified: no `rocket-loader` in the edge HTML).
- Web Analytics RUM: **Enable with JS Snippet installation** — the site now loads
  `beacon.min.js` itself after `load` + idle (BaseLayout `CF_BEACON_LOADER`, same public
  token); verified collecting (`cdn-cgi/rum` 204).
- Security → Bots → Bot Fight Mode: **OFF**. It had been switched back on since the
  2026-08-29 payment-callback incident. Checked first: 0 WAF custom rules, rate-limiting
  rule still active.
- Still injected after >15 min: `cdn-cgi/challenge-platform/scripts/jsd/main.js`
  (JavaScript Detections). No switch is exposed for it on this Free-plan zone in the
  dashboard; the API field is `enable_js` on `/zones/:id/bot_management`. It does not
  affect PageSpeed Insights; it causes TBT and the `deprecations` Best Practices audit
  in non-bot tools.

Code (deployed):
- 3c33374e — Cloudflare Web Analytics after load + idle; returning-visitor trust strip
  hidden before first paint (RUM showed CLS 0.106 on the section under it).
- 76e1b3bb — telemetry beacon as `text/plain`: `sendBeacon` sends credentials, and the JSON
  content type forced a credentialed CORS preflight the API rightly refuses; every batch
  was blocked with a console error (PSI Best Practices 96 on product pages).
- 7b00f8a0 — bot-flagged telemetry answered 204 instead of 403 (still discarded; no
  console error in headless browsers).

Results: PageSpeed Insights mobile — home **100** (FCP 1.1 s, LCP 1.2 s, TBT 0, CLS 0.007,
SI 1.5 s), shop **100 / 100 / 100 / 100** (FCP 1.1 s, LCP 1.2 s, CLS 0.003), product page
performance **100** (FCP 1.0 s, LCP 1.0 s). After the telemetry fixes, no console errors on
home, shop or product page; Lighthouse 13 from a non-bot browser: Accessibility 100, SEO
100, Best Practices 100 on home and shop, 81 on the product page from `deprecations`
(the JavaScript Detections script).
