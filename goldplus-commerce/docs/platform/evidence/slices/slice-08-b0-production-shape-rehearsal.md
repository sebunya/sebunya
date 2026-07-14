# Slice 8-B0 — Production-Shape Rehearsal

Date: 2026-07-14 (Africa/Kampala)

## Local production build

The production build completed successfully and was served locally from `apps/web/dist/server/entry.mjs` without an authenticated cookie.

## Logged-out route protection

All routes returned `303` before rendering, with the expected local `/admin/login?returnTo=...` location and zero protected-body markers:

- `/admin/measurement`
- `/admin/measurement/attribution`
- `/admin/measurement/consent`
- `/admin/measurement/dlq`
- `/admin/measurement/control-tower/controlled-activation/live-review`
- `/admin/measurement/control-tower/controlled-activation/live-review/test-candidate`

The scanned response bodies contained none of: Measurement Control Tower, Control Tower, destinations, dead letter, match quality, replay, internal admin navigation, or `apiFetch(`.

Existing protected routes `/admin`, `/admin/loyalty` and `/admin/recommendations/preview` also returned `303`; `/admin/login` returned `200`.

## Public and checkout regression smoke

- `200`: `/`, `/shop`, `/shop?search=charger`, `/loyalty`, `/support`, `/track-order`, `/terms`, `/privacy`, `/robots.txt`, `/sitemap.xml`.
- Expected `303`: `/checkout`.

## Boundaries

No approved authenticated session was used, so authenticated operator UAT remains pending. Static source review and the production build prove that an existing session continues past the new guard into the unchanged Measurement page implementation.

No API was started or changed, no provider was queried or activated, no customer communication was sent, and no checkout/payment behavior changed.

Decision: the web-only deployment shape is rehearsed and safe.
