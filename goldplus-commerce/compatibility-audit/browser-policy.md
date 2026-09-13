# GoldPlus browser support policy (2026-09-13)

Evidence basis: GoldPlus records no privacy-safe browser-family or viewport
aggregate on ordinary storefront pages (discovery: only `recommendation_events`
carries browser/OS/viewport columns, row-level and rail-only; `seo_web_vitals`
is CrUX form-factor only). This policy is therefore a **rational emerging-market
matrix for Uganda**, to be revised once first-party aggregates exist. It does not
promise "all browsers".

## Tier A — full commerce support
Every critical journey (discovery, search, category, product, cart, checkout
entry, PesaPal handoff, battery finder, delivery/support, WhatsApp handoff)
must work.

| Browser | Versions | How it is tested today |
|---|---|---|
| Chrome Android | current and previous major | Chromium engine, emulated viewports (small low-end, mainstream, large); real device AWAITING_REAL_DEVICE |
| Samsung Internet | current and previous major | AWAITING_REAL_DEVICE — no engine control stands in for it |
| Android WebView (Chrome-based) | Android 10+ | AWAITING_REAL_WEBVIEW_VALIDATION |
| Safari iOS | current and previous iOS | WebKit engine control (375/390/430 widths); real device AWAITING_REAL_DEVICE |
| Chrome / Edge desktop | current and previous major | Chromium engine at 1366 and 1920 |
| Firefox desktop | current and previous major | Firefox engine at 1440 |
| Safari macOS | current | WebKit desktop engine control; real browser AWAITING_REAL_DEVICE |

## Tier B — functional commerce support
Commerce works; non-essential enhancements (search suggestions, hero
autoplay, recommendation rails, install prompt) may degrade.

- Firefox Android, Chrome iOS (WebKit-based), Opera Android, Edge Android.
- In-app browsers: WhatsApp, Facebook, Instagram, TikTok (system WebView).
- Older Chromium builds (two majors behind) and Android 8–9 WebViews.

## Tier C — basic access
Product and content pages render and are readable; JavaScript enhancements
may be absent. Cart and checkout are form POSTs and work without JavaScript
(discovery: cart and checkout are server-rendered forms), so commerce is
usually still possible.

- Opera Mini (extreme mode), UC Browser, OEM browsers with legacy engines.

## Unsupported
- Internet Explorer, legacy Edge (EdgeHTML), Android 4.x stock browser.
- Any browser without TLS 1.2.

## Rules
- No UA sniffing, no generic polyfills, no per-browser JavaScript. Fixes follow
  the hierarchy in the README (HTML → CSS → config → build target → progressive
  enhancement → tiny feature-detected fallback).
- Engine controls (Playwright Chromium/Firefox/WebKit) are never reported as a
  named browser. Real cells need the single real-device provider.
- Priority among lightweight/OEM browsers is decided by evidence once
  first-party browser aggregates exist; until then they are Tier B/C by design.
