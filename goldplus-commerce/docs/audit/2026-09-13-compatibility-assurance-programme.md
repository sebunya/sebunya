# GoldPlus Continuous Compatibility Assurance — implementation report (2026-09-13)

Evidence vocabulary as before: FOUND / REPRODUCED / FIXED / TEST VERIFIED / PUSHED / DEPLOYED / LIVE VERIFIED / OWNER ACTION / UNRESOLVED / BOUNDED. Evidence classes for compatibility cells: ENGINE_CONTROL / EMULATED_VIEWPORT / EMULATED_CONSTRAINED_DEVICE / EMULATED_NETWORK / REAL_DEVICE / AWAITING_REAL_DEVICE / AWAITING_REAL_WEBVIEW_VALIDATION / MANUAL_AT_VALIDATION_REQUIRED.

## 1. Repository state

| | |
|---|---|
| Starting SHA | 97d51c4e (before this programme) |
| Programme commits | dfed13d3 (local Lighthouse provider), e0c6e98e (compatibility-audit + integration) |
| Branch | deploy/price-floor-145k |
| Storefront code changed by this programme | none during discovery and baseline (rule 2 honoured); see §11 for the one reproduced fix and its two gates |

## 2. Performance golden master

Run `20260913T080736Z`, label `compatibility-performance-golden-master` (retention-protected), repo 80c13535 deployed, Lighthouse 12.8.2 from the runner's Chromium, 3 runs per cell, medians with every individual run kept (`providers/lighthouse/raw.json`).

| Cell | Perf (runs) | A11y | BP | SEO | FCP | LCP | CLS | TBT | SI | Total | JS | Requests | Long tasks |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| home / mobile (slow-4G, 4× CPU) | 93 (85/95/93) | 100 | 100 | 92 | 2160 ms | 2533 ms | 0.001 | 167 ms | 2360 ms | 358 KB | 41 KB | 27 | 11 |
| home / desktop | 100 (100/98/100) | 100 | 100 | 92 | 534 ms | 700 ms | 0.042 | 0 ms | 707 ms | 359 KB | 41 KB | 27 | 0 |
| shop / mobile | 99 (96/99/99) | 100 | 100 | 92 | 1704 ms | 1856 ms | 0.003 | 0 ms | 1881 ms | 220 KB | 25 KB | 19 | 4 |
| shop / desktop | 100 (100/100/100) | 96 | 100 | 92 | 512 ms | 552 ms | 0.001 | 0 ms | 681 ms | 269 KB | 25 KB | 23 | 0 |

Observed variance (the noise band the non-regression comparison uses): home mobile perf 85–95, LCP 2163–3007 ms, TBT 0–326 ms; desktop LCP 574–1076 ms. The first run of every cell carries 4 extra requests and ~10–17 KB more script: the service worker's first-visit precache (sw.js + eight shell entries), which is by design and bounded. SEO 92 and desktop-shop accessibility 96 are the Cloudflare-owned and known items from the Lighthouse Watch programme.

Control probe at the same time: browser TTFB 209–406 ms, LCP 340–576 ms unthrottled; origin TTFB 53–87 ms.

## 3. Support policy

`compatibility-audit/browser-policy.md`, `pwa-policy.md`, `constrained-device-policy.md`, `network-policy.md`. Tier A: Chrome Android, Samsung Internet, Chrome-based WebView, Safari iOS, Chrome/Edge/Firefox desktop, Safari macOS (current and previous). Tier B: Firefox Android, Chrome iOS, Opera Android, in-app browsers, older Chromium. Tier C: Opera Mini, UC, OEM legacy engines. Unsupported: IE, EdgeHTML, Android 4.x. Minimum viewport 320 px. Evidence basis: no first-party browser aggregate exists yet (discovery §6), so the matrix is rational, not measured, and says so.

## 4. Discovery facts the programme is built on

- Fully server-rendered storefront, zero Astro islands, no polyfills, no UA sniffing; cart and checkout are form POSTs that work without JavaScript.
- Hand-written manifest and service worker (`goldplus-v4`, 8 precache entries, network-first navigations, offline page, no runtime writes, skipWaiting + clients.claim, sensitive routes bypassed).
- Breakpoints: Tailwind stock + navigation switch at 980 px and 380 px; `100dvh` on the mobile drawer; no safe-area insets; fonts self-hosted Plus Jakarta Sans with metric-matched fallback; zoom allowed (maximum-scale 5).
- Search suggestions: same-origin relay that always answers `200 []`, and a client `catch` that renders "No match" — a network failure reads as an empty catalogue (P2 candidate, reproduced by the constrained-network test).
- Checkout: server-authoritative validation, localStorage draft, phone field without `autocomplete="tel"` (P3).
- Analytics: no privacy-safe browser/viewport aggregate on ordinary pages.

(Sections 5–12 are completed from the baseline run below.)
