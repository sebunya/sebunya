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

* **every 6 hours** from the host (`/etc/cron.d/goldplus-lighthouse-watch` →
  `scripts/lighthouse-watch.sh cron`), in the Playwright image already on the
  host, CPU-limited so customers are unaffected;
* **after every deploy** (`scripts/deploy-prod.sh` starts a run in the
  background as its last step);
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
6 hours — identical to what pagespeed.web.dev shows — and records them the same
way. The keyless API is shared and quota-exhausted, so it is not used.
