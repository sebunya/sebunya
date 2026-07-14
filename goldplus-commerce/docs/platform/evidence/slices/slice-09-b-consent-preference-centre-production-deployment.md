# Slice 9-B Consent Preference Centre production deployment

## Deployment result

- Deployment shape: checksum-scoped web-only overlay.
- Production host Git metadata remained at known older commit `f69aa6e038fb1bd0964a1cf0cdb6e6ee0208a751`; no Git pull, reset or broad source sync was performed.
- Backup: `/opt/goldplus/backups/slice-09-b-20260714T183126Z`.
- Existing backed-up path: `apps/web/src/layouts/BaseLayout.astro` with relative path preserved.
- New paths recorded as absent before deploy: `apps/web/src/pages/preferences.astro`, `apps/web/src/pages/consent.astro`, `apps/web/src/lib/preference-centre.ts`.
- Overlay: exactly those three new files plus the reviewed `BaseLayout.astro`.
- Host checksums matched reviewed local checksums for all four runtime files.
- Host web image build: passed before restart; image manifest list `sha256:97fff738cc6adb5f311e5391d88f483bf1c0f8ccb3ffb29b1ef59ab03ff9c3ad`.
- Restart: only `web-1` and `web-2` recreated, both healthy; API, providers, queues and other services were not restarted.
- Migrations: none.
- Customer communications: none.
- Live providers touched: none.
- Secrets printed: none. Compose emitted only names of unset optional variables, not values.

## Production smoke

- `/`, `/shop`, `/shop?search=charger`, `/preferences`, `/loyalty`, `/support`, `/track-order`, `/terms`, `/privacy`, `/robots.txt`, `/sitemap.xml`: 200.
- `/consent`: 303 to `/preferences`.
- `/checkout`: 303 to `/cart`; checkout/payment source and behavior remain unchanged.
- `/admin/login`: 200.
- `/admin/measurement` and all five 8-B1 repaired operational admin routes: 303 to their admin-login return targets while logged out.
- All five mandatory Preference Centre truth statements present.
- Support, privacy and terms links present.
- Body contains none of: saved successfully, preferences updated, subscribed, consent recorded, WhatsApp sent, email sent, SMS sent, Memory Lane enabled, rewards activated, discount unlocked, coupon generated.

## Source and safety status

No customer preference was stored; no account, order, inventory or customer data was read; no email, WhatsApp or SMS was sent; no provider or queue was activated; no loyalty, Memory Lane, personalisation, discount, coupon or utilisation offer became live. Recommendations, Measurement transport, admin protection, auth/RBAC, checkout and payment remain outside the artifact.

## Rollback

Restore `BaseLayout.astro` from the timestamped backup, remove the three files that were absent before deployment, rebuild the web image, recreate only two web replicas, and rerun public/admin smoke. If a rollback is needed after push, use a forward rollback commit; never force-push.
