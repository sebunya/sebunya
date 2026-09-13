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
