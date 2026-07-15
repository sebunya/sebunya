# Slice 9-Y PRIME rollback plan

## Immediate containment

Keep `CONSENT_PROVIDER_LIVE_SENDS_ENABLED`, `CONSENT_PERSISTENCE_COMMANDS_ENABLED` and `CONSENT_PREFERENCE_CENTRE_SAVE_ENABLED` false. Removing the Slice 9-Y override and recreating API/web from the base Compose file also returns every consent gate to its fail-closed default. No provider or customer-send rollback is required because no such capability was activated.

## Source and service rollback

1. Confirm the backup hashes recorded in the deployment evidence.
2. Stop only API/web recreation activity; do not stop PostgreSQL, Redis, Caddy or unrelated services.
3. Restore the pre-release source from `/opt/goldplus/backups/slice-09-y-prime-20260715T073307Z/source-before.tar.gz` into `/opt/goldplus/app/goldplus-commerce`.
4. Rebuild/recreate only API and web using the pre-release production Compose convention.
5. Verify both health endpoints, storefront, shop, representative PDP, admin redirects and logged-out API protection.

## Database rollback stance

The migration is additive and every new table remained empty after UAT smoke. Preferred rollback is therefore to disable consumers and leave the empty append-only foundation in place; destructive table removal is not authorized by this slice.

If a database-wide restore becomes necessary under a separately approved outage window, the custom-format backup is `/opt/goldplus/backups/slice-09-y-prime-20260715T073307Z/database-before.dump`. Redacted command shape, to be executed with container-provided credentials and not run during this slice:

```text
pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists <database-before.dump>
```

Before any restore: stop writes, create a fresh incident-time dump, confirm the target database, obtain explicit restore authorization, and verify payment/order integrity afterward. Never print credentials or connection URLs.

## Verification after rollback

- API/web healthy and public routes free of 500 responses.
- Admin and support routes remain deny-by-default.
- All consent feature gates false.
- No provider transport or customer communication invoked.
- Checkout, payment, PesaPal and order paths unchanged.
- Backup and rollback evidence retained outside git; no backup or environment file committed.
