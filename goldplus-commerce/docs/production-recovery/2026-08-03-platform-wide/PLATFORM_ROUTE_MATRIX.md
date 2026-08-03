# Platform route matrix — 2026-08-03 (generated from source)

## Inventory (from source, not memory)
- Web pages (Astro): **124** (public + customer + admin).
- API route mounts (app.ts `app.route`): **55** prefixes.
- API route handlers (get/post/put/delete/patch): **293**.
- Admin API route files: **36**.

## Mounted API prefixes
account, account/behavioural-interventions, account/consent-operating,
account/surveys, admin/analytics, admin/audit, admin/automation,
admin/behavioural-interventions, admin/compatibility, admin/consent-operating,
admin/control-centre, admin/controlled-activation(+dry-run, live-review,
live-canaries), admin/copy-quality, admin/customer-dna,
admin/decision-intelligence, admin/delivery-zones, admin/deployment,
admin/experiments, admin/fraud, admin/fulfilment, admin/inventory, admin/loyalty,
admin/measurement(+control-tower, gtm, paid-social, payments), admin/modules,
admin/notifications, admin/pim-imports, admin/pricing, admin/products,
admin/queues, admin/recommendations, admin/release-readiness, admin/roles,
admin/search-demand, admin/surveys, admin/users, api/admin/consent/operations,
auth, commerce, consent, governance, health, measurement, metrics,
product-finder, products, recommendations, telemetry, webhooks.

## Shared defect (RC-1) — affects the whole web data plane
Empty `apiBase` at build → relative SSR URLs → Node "Failed to parse URL" →
platform-wide "unavailable". Canonical fix: SSR uses internal origin
(`http://api:3000`) at runtime; browser uses public origin; empty treated as unset.
See ROOT_CAUSE_REGISTER.md. Fix commit `f9a5075`.

## Note — client-side `/api/*` calls (RC-2 to verify)
Some admin pages (measurement/*) fetch `/api/admin/measurement/*` client-side
(browser, same-origin). API mounts these as `/admin/measurement/*`; Caddy must
strip `/api` → API. Verify Caddy `/api` route after RC-1.

Full per-module status recorded in MODULE_CAPABILITY_MATRIX after the fix is
released and the live re-sweep runs.
