# Slice 8-B0 / 8-B0A — Production Deployment

Date: 2026-07-14 (Africa/Kampala)

## Source alignment and backup

- The earlier Slice 8-B0 attempt stopped safely before container recreation when the host source lacked tracked live-review utilities.
- Slice 8-B0A confirmed both utilities are tracked and clean in the approved branch, then aligned only those two files by exact copy.
- Fresh backup: `/opt/goldplus/backups/slice-08-b0a-20260714T160333Z`.
- The backup preserves all six prior Measurement routes, records both utilities as absent, and contains restricted Compose/environment configuration copies. Environment contents were not read or printed.
- The two utility files and six guarded routes matched local SHA-256 values exactly before build.
- No host Git pull, reset, checkout, hand edit or broad source sync occurred.

## Gates and build

- Focused Slice 8-B0 protection suite: 12/12 passed.
- All protected focused suites: 193/193 passed.
- Secret scan: passed; values were not printed.
- Typecheck: passed.
- Lint: passed with the established warning-only baseline and zero errors.
- Local production build: passed.
- Full suite: 138 files and 879 tests passed.
- Host production web image build: passed before any restart; no additional drift appeared.

## Web-only deployment

- Only `goldplus-commerce-web-1` and `goldplus-commerce-web-2` were recreated from the verified image.
- Both web replicas became healthy with creation time `2026-07-14T16:07:44Z`.
- Both API replicas remained healthy with unchanged creation times `2026-07-13T21:20:09Z`.
- Database, Redis, Caddy and API services were not restarted.
- No migration, provider activation, queue action or customer communication occurred.

## Logged-out admin protection

The following production routes returned `303` to their secure login targets with zero protected-body markers:

- `/admin/measurement`
- `/admin/measurement/attribution`
- `/admin/measurement/consent`
- `/admin/measurement/dlq`
- `/admin/measurement/control-tower/controlled-activation/live-review`
- `/admin/measurement/control-tower/controlled-activation/live-review/test-candidate`

The logged-out bodies exposed none of: Measurement Control Tower, Control Tower, destinations, dead letter, match quality, replay, DataLayer, or Control Tower interface.

Existing `/admin`, `/admin/loyalty` and `/admin/recommendations/preview` protection remained `303`; `/admin/login` remained `200`.

Authenticated operator UAT remains pending because no approved production session was used. The guard passes existing sessions into the unchanged page implementation.

## Public and recommendation smoke

- `200`: homepage, shop, charger search, loyalty, support, track-order, terms, privacy, robots and sitemap.
- Expected `303`: checkout.
- Two real PDPs returned `200`: GoldPlus 100W Portable Power Station and GoldPlus 16GB USB Flash Drive.
- Each PDP rendered two recommendation rails; each rail had unique IDs, excluded the current product and contained no unsupported popularity or personalisation label.

## Safety boundaries

Checkout/payment, auth/RBAC contracts, Measurement transport/destinations/providers, recommendations, loyalty, customer communication and persistence were unchanged.

## Rollback

Restore the six prior routes from `/opt/goldplus/backups/slice-08-b0a-20260714T160333Z/source`, remove the two utility paths recorded in `absent-before-alignment.txt`, rebuild `web`, recreate only both web replicas, and repeat logged-out admin, body-exposure, public, checkout and PDP smoke checks.

Decision: Slice 8-B0A production deployment verified successfully.
