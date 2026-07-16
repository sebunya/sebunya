# Slice 13B — Browser, accessibility and performance acceptance

Date: 2026-07-16 · Astro dev server (127.0.0.1:4321) + local API/PostgreSQL stack.

## Browser matrix (Playwright 1.61, installed this slice — the repo's `test:e2e`
## script previously had no Playwright dependency at all: repaired)

| Project | Result |
|---|---|
| chromium-desktop (Desktop Chrome) | **6/6 pass** |
| chromium-mobile (Pixel 7) | **6/6 pass** |
| firefox-desktop / webkit-desktop / webkit-mobile | Declared in `playwright.config.ts`; **environment-gated**: this container ships Chromium only and forbids browser downloads (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`). Exact requirement: run `npx playwright test` on a machine with Firefox/WebKit binaries. |

## Flows proven in a real browser (both viewports)

1. Homepage: `lang="en-UG"`, main landmark, skip link present, **first Tab focuses the
   skip link** (keyboard/focus verification).
2. Shop search finds the catalogue product; zero-result search shows the truthful
   empty state with "Request this product" and "Ask support" CTAs.
3. PDP renders the admin-declared "Verified compatibility" section with its
   condition note.
4. Legal pages render registry status chips ("Draft — pending legal review",
   "Interim public guidance") and support-routed claims.
5. Logged-out `/admin/demand` redirects to `/admin/login` in the browser.
6. Viewport meta permits pinch zoom (no `user-scalable=no` / `maximum-scale=1`).

Defects found while getting green: a strict-mode violation (footer + CTA both match
"Contact support" — test scoped with `.first()`), plus two environment restarts
(API/PostgreSQL processes reaped between phases) — no application defects.

## Performance evidence (production build)

- Client JS: **357 KB raw across 28 files** (islands — largest are the
  location picker, recommendation preview panel, rails); CSS 172 KB raw.
  Pages are server-rendered; scripts are per-island, not a monolithic bundle.
- Budgets (recorded as the working budget set): total client JS ≤ 400 KB raw,
  per-island ≤ 60 KB, CSS ≤ 200 KB — currently within budget.
- **Lighthouse/Core-Web-Vitals lab runs are environment-gated**: honest scores
  require `astro build && astro preview` plus a Lighthouse binary; dev-server
  scores would be misleading and are not recorded. Exact requirement: run
  `npx lighthouse http://<preview>/ --preset=desktop|mobile` against the built
  preview and append results here.

WCAG 2.2 AA static contract (lang/viewport/skip/reduced-motion/lazy+alt imagery)
remains enforced by `Slice13AccessibilityPerfContract`; screen-reader manual pass
remains an operator action.
