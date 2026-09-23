# Strict script policy (CSP): observe, then enforce

## Why

The enforced Content-Security-Policy is set by Caddy (`Caddyfile`, storefront
block). Its `script-src` contains `'unsafe-inline'`, so a script injected into
any page (a stored XSS in a product name, a compromised field in the CMS) would
run. Mozilla Observatory scores the site B+ for that reason.

Removing `'unsafe-inline'` from Caddy's policy in one step would block every
inline script the site relies on: the GTM and Clarity bootstraps, the font
loader, the Cloudflare Web Analytics beacon, and Rocket Loader's loader while it
is switched on. Checkout would break with them.

## What is in place (2026-09-23)

- **A nonce on every script.** The web middleware gives each HTML response a
  fresh 128-bit nonce and stamps it on every `<script>` tag as the page streams
  (`apps/web/src/lib/contentSecurityPolicy.ts`).
- **A strict policy alongside Caddy's.** It is sent as
  `script-src 'nonce-…' 'strict-dynamic' https: 'unsafe-inline'; object-src 'none'; base-uri 'self'; report-uri /api/csp-report`.
  Browsers that understand nonces ignore the `https:` and `'unsafe-inline'`
  entries, which only keep very old browsers working.
- **Report-only by default.** `CSP_STRICT_MODE=report` blocks nothing and only
  reports. `enforce` makes the policy binding. `off` removes it. Any other value
  counts as `report`, so a typo can never start blocking scripts.
- **No inline event handlers.** A strict policy can never allow `onclick=` and
  similar attributes, whatever the nonce. The 20 that existed were moved to data
  attributes handled by `components/DeclarativeActions.astro`
  (`data-confirm`, `data-action="reload|print"`, `data-submit-on-change`,
  `data-navigate-on-change`, `data-fallback-src`). A unit test fails the build
  if one comes back (`tests/unit/StrictScriptPolicy.test.ts`).
- **A report endpoint.** `/api/csp-report` logs each distinct violation once an
  hour with a running count, as `CSP_VIOLATION {...}` in the web container log.
  It keeps no address, query string or fragment.

Verified locally in Chromium on `/`, `/shop`, `/offline`, `/cart`, `/checkout`
and `/faq`: zero violations from our own code. GTM and Clarity were not
configured locally, so those two could not be checked.

## Steps to enforce (owner / operator)

1. **Turn Rocket Loader OFF in Cloudflare** (Speed → Optimization). It rewrites
   script tags and injects its own loader without our nonce, so enforcement
   would stop every script on the page. It is also already recommended off for
   speed (`cloudflare-lighthouse-owner-settings.md`).
2. **Deploy this change and wait about a week** of real traffic in `report` mode.
3. **Read the reports.** On the host, run
   `docker logs goldplus-commerce-web-1 2>&1 | grep CSP_VIOLATION | sort | uniq -c | sort -rn | head -50`
   (and the same for `web-2`).
   - `blocked: "inline"` with a source on our domain is an inline script
     without a nonce. That is a bug to fix in code before enforcing.
   - A third-party origin that GTM or a tag loads should not appear, because
     `'strict-dynamic'` trusts what a nonced script loads. If one does, find what
     loaded it.
   - Rows from `chrome-extension:` or `moz-extension:` are visitors' browser
     extensions. Ignore them.
4. **When only extension noise is left,** set `CSP_STRICT_MODE=enforce` in
   `.env.production` and roll the web service. The Caddy policy stays in place;
   a script must pass both.
5. **Watch the log and checkout for a day.** Rolling back needs no code change:
   set `CSP_STRICT_MODE=report` and roll the web service again.
6. Later, optionally, remove `'unsafe-inline'` from Caddy's `script-src` too.
   It has no effect once the strict policy is enforced, but removing it lets
   scanners score the site properly.

## Caveats

- If HTML were ever cached at Cloudflare, visitors would share a nonce. That
  weakens the protection but breaks nothing. HTML is not edge-cached today
  (Caddy sends no cache header for pages, and Cloudflare does not cache HTML by
  default). Keep it that way when the strict policy is enforced.
- Adding a new inline `<script>` needs no special handling, because the nonce
  is stamped automatically. Adding an `on…=` attribute will fail the unit test.
