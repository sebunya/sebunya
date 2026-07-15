# Slice 13 — Performance & Accessibility Verification Matrix

Updated 2026-07-15 (Slice 13A). Honest split between what is verified in source
right now and what requires a running environment.

## Statically verified (regression-tested in `Slice13AccessibilityPerfContract`)

| Check | State |
|---|---|
| `<html lang="en-UG">` | ✔ enforced |
| Zoom-friendly viewport (no `user-scalable=no`, no `maximum-scale=1`) | ✔ enforced site-wide |
| Focus-visible skip link + uniform `#main` landing target | ✔ added in 13A |
| `prefers-reduced-motion` honoured globally | ✔ added in 13A |
| Product imagery lazy-loaded with alt text | ✔ enforced |
| Admin deny-by-default protection (56 pages) | ✔ Slice 8-B1 sweep |
| Admin truthful states (no fabricated data) | ✔ Slice 7A contract |
| Newsletter truthful not-configured state; full brand taxonomy | ✔ Slice 2 residual contract |

## Requires a running environment (exact requirement)

| Check | Requirement |
|---|---|
| Lighthouse baseline + performance budgets | Running web+api+PostgreSQL stack or staging URL; run `lighthouse` against /, /shop, PDP, /checkout; store scores here |
| Core Web Vitals field data | Production traffic via existing measurement foundation |
| 3-engine responsive matrix (Chromium/Firefox/WebKit) | `pnpm test:e2e` (Playwright) against a running stack; container has Chromium only |
| Screen-reader pass | Manual NVDA/VoiceOver session |

Status: environment-dependent rows are BLOCKED_EXTERNAL on a running stack /
staging access from the execution environment. No scores are invented; this file
must be updated with real numbers when those runs execute.
