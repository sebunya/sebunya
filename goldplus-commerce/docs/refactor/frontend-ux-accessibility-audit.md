# Frontend UX And Accessibility Audit

Protected systems touched: NO production code mutated.
Protected systems inspected: YES, recommendation rails were inspected read-only.

## Top 10 Frontend And Accessibility Risks

| Severity | Finding | Evidence | Risk | Recommended fix |
| --- | --- | --- | --- | --- |
| High | Admin SSR fetch helper omits Authorization | `apps/web/src/lib/api.ts:20` | Admin pages depend on unauthenticated API reads. | Token-aware admin fetch helper. |
| Medium | Missing payment icon asset | `BaseLayout.astro:258` references `/payment/airtel-money.svg`, absent in `public/payment`. | Broken footer image. | Add asset or remove reference. |
| Medium | Checkout offline draft can confuse production users | `checkout.astro:138` | User may treat local draft as submitted order. | Feature flag or stronger production constraint. |
| Medium | Service worker has limited offline catalog behavior | `sw.js:48` | Navigations fall to offline page; safe but shallow. | Add safe static/catalog cache strategy. |
| Medium | Astro templates are not fully type-checked by CI | `apps/web/package.json` | Template-only errors can pass. | Add `astro check`. |
| Medium | Large layout/components mix copy, data, and presentation | `BaseLayout.astro`, `Header.astro`, `shop.astro` | Harder to maintain and test. | Extract small semantic components cautiously. |
| Medium | Repeated fetch fallback patterns | `shop.astro`, product detail, recommendation rails | Inconsistent error states and timeouts. | Shared SSR fetch/fallback helper. |
| Low | Some UI cards use large rounded styles across app | Multiple Astro files | Design consistency concern, not functional. | Only normalize with visual QA. |
| Low | Inline scripts and SVGs are common | Base layout and pages | Harder CSP hardening. | Move toward external modules and nonce-ready CSP. |
| Low | No automated accessibility gate observed | tests | WCAG regressions can slip. | Add Playwright/axe smoke for critical flows. |

## Existing Strengths

- Semantic landmarks exist in many areas (`main`, `nav`, `header`, `footer`, form labels).
- Product images generally have alt text.
- Sensitive service worker routes avoid caching admin, checkout, cart, account, payment.
- Catalog has resilient fallback data.
- Empty states and error notices exist.

## Suggested No-Redesign Refactors

- Fix missing asset.
- Add token-aware admin fetch helper.
- Add shared SSR API timeout/fallback helper for public catalog fetches.
- Add `astro check`.
- Add accessibility smoke tests for shop, product detail, cart, checkout, admin login.

