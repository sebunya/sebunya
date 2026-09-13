# Cloudflare settings that cap the Lighthouse scores (OWNER ACTION)

Measured 2026-09-13 with Lighthouse 12 against https://shopgoldplus.com/ after the
storefront performance pass (commit a49145cb). Everything the code could fix is
fixed. The items below are zone settings only the Cloudflare account holder can
change; each one is a script Cloudflare injects into every page, or a file it
rewrites, and each shows up by name in the audit.

| Cloudflare setting | Where | What Lighthouse reports | Set to |
|---|---|---|---|
| Rocket Loader | Speed → Optimization → Content | `rocket-loader.min.js` in the request list; it rewrites and defers every `<script>`, delaying the hero and nav scripts and adding a render-blocking fetch | **Off** |
| JavaScript Detections (bot management) | Security → Bots | `challenge-platform/.../jsd/main.js`: ~1 s of main-thread scripting on a phone and three **deprecation warnings** (SharedStorage, Fledge, StorageType.persistent) that fail Best Practices | **Off** (Bot Fight Mode is already off; the PesaPal IPN needs it off) |
| Web Analytics beacon | Analytics → Web Analytics | `static.cloudflareinsights.com/beacon.min.js`. The site's Content-Security-Policy now allows it, so it no longer logs a violation; it is still a third-party script on every page | Keep if you use the reports; otherwise **Off** |
| Managed robots.txt / Content Signals | AI Audit (or Bots) → "Manage AI crawlers" / robots.txt | Cloudflare prepends `Content-Signal: search=yes,ai-train=no,use=reference` to robots.txt; Lighthouse SEO flags it as an **unknown directive** (score 92 instead of 100). The site's own robots.txt already blocks AI training crawlers | **Off**, or accept the 92 |
| Browser Cache TTL | Caching → Configuration | Was the 4-hour default, so every static file re-fetched on return visits. The origin now sends 30-day headers for static files | **Respect Existing Headers** |
| Early Hints, HTTP/3, Brotli | Speed → Optimization / Network | All help; none hurt | **On** |

After changing any of these, purge the Cloudflare cache once (Caching → Purge
Everything) and re-run https://pagespeed.web.dev/ for mobile and desktop.

## Lighthouse Watch — what keeps measuring after this pass

Shipped 2026-09-13 (`3dbf0121`). Real Lighthouse 12, the engine behind PageSpeed
Insights, runs against the live site for `/` and `/shop`, mobile and desktop:

* **at most once every 96 hours** (owner decision): cron checks daily at 03:17 UTC
  (`/etc/cron.d/goldplus-lighthouse-watch` → `scripts/lighthouse-watch.sh cron`)
  and the deploy hook offers a run after every roll, but the runner skips any
  automatic run within 96 h of the last one (stamp: `/var/log/goldplus/
  lighthouse-watch.last-run`). `./scripts/lighthouse-watch.sh manual` runs now.
  In the Playwright image already on the host, CPU-limited;
* log: `/var/log/goldplus/lighthouse-watch.log`.

Each run posts to `POST /internal/lighthouse/report` (machine token in
`.env.production`, `LIGHTHOUSE_WATCH_TOKEN`). The API stores the four
category scores and the audits that cost points as Web Vitals rows, compares
every URL × form factor × category with its target (100 by default;
`LIGHTHOUSE_WATCH_TARGET_PERFORMANCE|ACCESSIBILITY|BEST_PRACTICES|SEO` to
change), and keeps one SEO alert per shortfall: **WARN** when every failing
audit is a Cloudflare setting from the table above, **CRITICAL** when code is
the cause. A cell back at target closes its alert. The API log carries
`ALERT LIGHTHOUSE_BELOW_TARGET` and the Prometheus gauge
`goldplus_lighthouse_score` while anything is below target.

Where to look: **Admin → SEO → Core Web Vitals**, "Lighthouse Watch" panel.

Optional: with a Google API key (PageSpeed Insights API enabled) in
`GOOGLE_PAGESPEED_API_KEY`, the API also pulls PageSpeed's own numbers every
96 hours — identical to what pagespeed.web.dev shows — and records them the same
way. The keyless API is shared and quota-exhausted, so it is not used.

## Rocket Loader — measured customer impact (2026-09-13, compatibility programme)

Rocket Loader is still ON. Evidence from a Chromium session against the live
site (compatibility-audit/browser/early-interaction.spec.ts and the probes that
found it):

- The storefront's one module script (`/_astro/hoisted.*.js`) is served twice:
  once as `<script type="module">` and once rewritten to
  `type="<hash>-module"`, and both copies download (two 200 responses per page).
- Every handler (menu, search suggestions, add-to-cart analytics, checkout
  draft) is bound only after `window.load`, when Rocket Loader executes the
  rewritten scripts. A tap on the menu or typing in checkout before that moment
  does nothing. On a slow connection with large hero images that window is
  seconds long.
- Chrome logs "A preload for hoisted.*.js is found, but is not used because the
  request credentials mode does not match" on every page.

The storefront binds its handlers synchronously in inline and module scripts;
none of this is application code. Switching Rocket Loader OFF removes the
double download and restores immediate interactivity. The post-deploy smoke
and the ten-day audit record the early-interaction result every run, so the
change will be visible as `tap_after_dcl_worked: true` in
`compatibility_manifest.json` → `early_interaction`.

## Third-party audits — the same three settings again (2026-09-13, owner's screenshots)

Seven tools measured the home page on 2026-09-13. The ones that reach the site as
an ordinary browser see Cloudflare's injected scripts; PageSpeed Insights, whose
Lighthouse runs as a verified bot, does not. That is the whole difference between
"94–96" and "75–84":

| Tool | Score | What it saw |
| --- | --- | --- |
| PageSpeed Insights, mobile (14:28 EAT) | 96 | no injected scripts; TBT 70 ms, LCP 2.4 s |
| PageSpeed Insights, mobile (05:36 EAT) | 94 | TBT 30 ms, LCP 2.8 s |
| SpeedVitals, mobile | 84 | TBT 628 ms, of which `cdn-cgi/challenge-platform/scripts/jsd/main.js` **501 ms**, `rocket-loader.min.js` 19 ms; application scripts 106 ms |
| DebugBear, 14 pages | 75–93 (avg 84) | mobile pages 75–83 with LCP 1.3–1.9 s and CLS 0: the score is TBT from the same injected script |
| GTmetrix, desktop | A 89 % | TBT 0, CLS 0, LCP 1.5 s; "reduce initial server response time 629 ms" |
| WebPageTest, desktop (Iowa) | — | TTFB 635 ms, LCP 1.31 s, CLS 0, TBT 117 ms; console: the modulepreload for `_astro/hoisted.*.js` "was not used" because Rocket Loader rewrote the script tag |
| Yellow Lab | A 91 | 8 webfonts (all used: 3 Poppins for hero/nav, 5 Plus Jakarta Sans) |

Owner actions, unchanged: **JavaScript Detections OFF** (Security → Bots) removes
the 501 ms; **Rocket Loader OFF** (Speed → Optimization → Content) stops the
double download and the unused preload; the **Web Analytics beacon** is a
10 KB third-party script the owner may keep or drop.

The 630 ms time-to-first-byte reported from US test locations is distance, not
the application: the origin renders `/` in 60–140 ms and the product page in
80–110 ms (measured on the host through Caddy). Cloudflare Argo Smart Routing /
Tiered Cache or a closer region would move it; nothing in the code will.
