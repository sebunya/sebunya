# Slice 8-A production-shape rehearsal

Date: 2026-07-14 (Africa/Kampala)

## Local production build

- `/loyalty` returned `200` and visibly rendered programme-not-active truth, setup progress, preview quests, future badge states, tier previews, Memory Lane safeguards, utilisation rules, discount governance, reveal safeguards, launch readiness and risk controls.
- Logged-out `/admin/loyalty` returned `303` to `/admin/login?returnTo=/admin/loyalty`.
- A synthetic local-only session rendered the protected read-only operator preview, mechanic leaderboard, utilisation scorecard and disabled-activation reason without exposing the cookie value.
- Negative checks found no forbidden live claims, random generator, cookie/local-storage use, bearer token or API base configuration in rendered output.
- Home, shop, search, existing PDP, support, track-order, terms, privacy, robots and sitemap returned `200`; checkout and protected admin routes retained expected `303` behaviour.
- Sitemap included `/loyalty`.

## Responsive visual QA

- Browser-rendered mobile viewport: `390 × 844`.
- Document and main widths remained `390px`; no body-level horizontal overflow.
- The 36px mobile hero heading, visible programme status, and both primary links rendered cleanly.
- All public main-content links met at least a 40px rendered touch height.
- Wide governance tables remain inside their intended horizontal-scroll containers.

Decision: production shape and mobile presentation rehearsed successfully.
