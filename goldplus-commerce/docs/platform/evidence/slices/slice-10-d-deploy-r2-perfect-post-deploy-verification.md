# Slice 10-D DEPLOY R2 PERFECT post-deploy verification

Production source remained clean at `13f282969aa2faf162fb3e4e3437a47f4e6de231`. Both API and both web replicas became healthy on the exact-source images.

Storefront returned `200`, API live health `200`, and Preference Centre `200`. Logged-out `/admin/consent-operations` returned protected redirect `303`; logged-out `/api/admin/consent/operations/summary` returned protected `401`. This proves the Control Room page and summary API are live behind their intended authentication boundaries without exercising an authenticated or mutating admin control.

Caddy retained ID `6f6e517ee9d0`, start time `2026-07-15T14:30:06.898875595Z`, and zero restarts. PostgreSQL retained `ebb57744324c`, `2026-07-12T20:33:46.62170169Z`, zero restarts. Redis retained `32c8a2475394`, `2026-07-13T03:34:44.34918138Z`, zero restarts.
