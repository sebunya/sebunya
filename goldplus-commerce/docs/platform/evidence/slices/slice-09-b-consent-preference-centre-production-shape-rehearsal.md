# Slice 9-B Consent Preference Centre production-shape rehearsal

## Local built-artifact rehearsal

The production-mode Astro server built from the scoped source was started locally on `127.0.0.1:4399` and checked without customer or provider state.

- `/`, `/shop`, `/preferences`, `/loyalty`, `/support`, `/track-order`, `/terms`, `/privacy`, `/robots.txt`, `/sitemap.xml`: 200.
- `/consent`: 303 to `/preferences`.
- `/checkout`: 303 to `/cart`, preserving the protected checkout behavior.
- `/admin/login`: 200.
- `/admin/measurement`: 303 to the admin login return target.
- All five required visible truth statements rendered.
- Support, privacy and terms links rendered.
- Body contained none of: saved successfully, preferences updated, subscribed, consent recorded, WhatsApp sent, email sent, SMS sent, Memory Lane enabled, rewards activated, discount unlocked, coupon generated.

## Deployment shape rehearsal

Only four runtime files require host overlay: the public page, alias, static helper and two-line `BaseLayout.astro` footer change. Tests and evidence are source artifacts and will not be copied into the running web source tree for the runtime build.

Planned sequence:

1. Confirm production public/admin pre-health.
2. Create a timestamped backup with prior files and a manifest noting absent new paths.
3. Copy only the four approved runtime files over SSH.
4. Compare host SHA-256 values with the reviewed local values.
5. Build only the web image on the host before restart.
6. Recreate only the two web replicas.
7. Verify healthy replicas, public journey, 303 checkout/admin protection, required body truth and forbidden-body absence.
8. Commit and push only after production verification.

No Git pull/reset, broad rsync, API restart, provider restart, queue restart, migration or customer communication is part of the rehearsal.

## Rollback rehearsal

Restore the prior `BaseLayout.astro`, remove the three paths recorded as absent before deployment, rebuild web, recreate only two web replicas, and repeat public/admin smoke. If smoke fails, do not commit or push.
