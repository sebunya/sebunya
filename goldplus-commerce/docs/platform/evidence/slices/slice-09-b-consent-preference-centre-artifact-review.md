# Slice 9-B Consent Preference Centre artifact review

## Allowed implementation artifact

- `apps/web/src/pages/preferences.astro`
- `apps/web/src/pages/consent.astro`
- `apps/web/src/lib/preference-centre.ts`
- `apps/web/src/layouts/BaseLayout.astro` — two scoped footer links only
- `tests/unit/Slice09BConsentPreferenceCentreP0.test.ts`
- Five Slice 9-B evidence files

The initially considered sitemap edit was removed before artifact approval because the strict allowlist explicitly permits scoped footer integration but does not name the sitemap. Footer discoverability is sufficient for this P0.

## Review result

- Runtime shape: web-only, static and read-only.
- New dependencies/lockfile: none.
- Database/API/schema/migration: none.
- Browser persistence, cookies or customer lookup: none.
- Forms, toggles, save/update actions: none.
- Provider transport, External Delivery, Measurement transport, queue/outbox: unchanged.
- Checkout, payment, PesaPal, orders and cart: unchanged.
- Auth/RBAC/session contract: unchanged.
- Loyalty ledger, reward, coupon, discount and personalised price: unchanged.
- Environment, backup and secret-like repository files: unchanged.
- Admin inventory: unchanged at 49 Astro pages; `/admin/login` remains the sole public admin route.
- `git diff --check`: clean.

## Source checksums before deployment

- `preferences.astro`: `dff46059f1020bb77fb264f780af8173ef8487cce66141781fff6bf9b2712fd4`
- `consent.astro`: `072b06f41ac577b308f0389d1e6694bae848b408cd5a64a64a44db64e627f3ab`
- `preference-centre.ts`: `d13bcd42b65f6e06cc874342523f7bbd5caccc6508b17f814fca484f8f840ba8`
- `BaseLayout.astro`: `b3c9b4435eabea6c44782d62dfac5a63cda98ccf407093aa55ecd214fd5802a5`

Decision: artifact approved for checksum-scoped web rehearsal and deployment.
