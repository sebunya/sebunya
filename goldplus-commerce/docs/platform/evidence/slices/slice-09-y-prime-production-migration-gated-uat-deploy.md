# Slice 9-Y PRIME production migration and gated UAT deploy

## Release identity

- Starting local and remote baseline: `f848f1e8aae83e0bb6e25f958dcf4b74fe2f53ce`.
- Branch: `phase-2-measurement-control-tower-completion`.
- Production source before release: branch `phase-1-functional-depth`, commit `f69aa6e038fb1bd0964a1cf0cdb6e6ee0208a751`, with an existing broad dirty overlay. A checkout or fast-forward was therefore rejected in favour of the runbook-authorized scoped overlay.
- Release scope: production consent-foundation migration plus API/web deployment of the 9-X operating layer. No provider activation or send capability was deployed.

## Backups completed before mutation

Backup root: `/opt/goldplus/backups/slice-09-y-prime-20260715T073307Z`.

| Backup | Path | Bytes | SHA-256 |
|---|---|---:|---|
| Production source | `/opt/goldplus/backups/slice-09-y-prime-20260715T073307Z/source-before.tar.gz` | 3,763,596 | `2ad8f747793e4781c0369ff1d973fad0e34215f327d4074d320aa06f6e7e0f87` |
| PostgreSQL custom-format dump | `/opt/goldplus/backups/slice-09-y-prime-20260715T073307Z/database-before.dump` | 250,950 | `bcb23bd3ae622e86727723065b6cea37643d5cfbac181a4c3bf35ef947413688` |

Both files existed and were non-empty before migration or deployment. Credentials and raw environment values were not printed.

## Migration preflight and execution

Migration: `apps/api/src/infrastructure/db/migrations/0022_low_phil_sheldon.sql`, SHA-256 `aa56877cc0614bfc334dde98b98d13e34ab40203bfd8300817f41fcde9d7c373`.

Preflight confirmed additive DDL for four enums, eleven tables, indexes, constraints, one append-only trigger function and three triggers. It contains no data backfill, auto-grant, provider credential, checkout/payment/order mutation, loyalty/reward mutation, provider activation or send operation. Existing production tables `consent_current_state` and `consent_records` did not conflict with the foundation object names. The exact migration ran inside `BEGIN`/`ROLLBACK` with `ON_ERROR_STOP=1`; every statement succeeded and the transaction rolled back.

The production journal contained later unrelated migrations. Its entries were preserved and the exact consent migration metadata was appended with its canonical timestamp. Execution used the repository's existing command shape, with secrets redacted:

```text
docker build -t <temporary-migrator-image> -f Dockerfile.api .
docker run --rm --network <production-network> --env-file .env.production <temporary-migrator-image> pnpm -F @goldplus/api db:migrate
```

Result: `Migrations complete!`. Verification found all 11 foundation tables and exactly one ledger row for timestamp `1784097790454`. Immediately after migration: zero current states, zero grants, zero consent events, zero provider unsubscribe events, zero suppressions and zero legacy mapping rows.

## Production deploy and gates

Production source received a scoped overlay of the 9-X runtime files plus the five required 9-B3 domain/schema/migration artifacts. No `.env.production`, secret, Credential Vault, payment, checkout, order, loyalty or provider transport file was overlaid.

API and web were built and recreated only with `--no-deps`. Four replicas became healthy: two API and two web. Post-deploy API and web health endpoints returned `200`.

The non-secret runtime override is `/opt/goldplus/runtime/slice-09-y-prime-no-send.override.yml`. Running API posture:

| Gate | Value |
|---|---|
| `CONSENT_PERSISTENCE_COMMANDS_ENABLED` | false |
| `CONSENT_PREFERENCE_CENTRE_SAVE_ENABLED` | false |
| `CONSENT_ADMIN_WORKFLOW_ENABLED` | true |
| `CONSENT_SUPPORT_WORKFLOW_ENABLED` | true |
| `CONSENT_PROVIDER_SUPPRESSION_INTAKE_ENABLED` | false |
| `CONSENT_PROVIDER_DRY_RUN_ENABLED` | true |
| `CONSENT_PROVIDER_LIVE_SENDS_ENABLED` | false |
| `CONSENT_LEGACY_MIGRATION_DRY_RUN_ENABLED` | true |

No synthetic-only public write guard exists, so command persistence and broad public Preference Centre saves remain disabled. No command write UAT was forced.

## Release result

Production migration succeeded, the gated operating layer is deployed, and no-send readiness passed. No WhatsApp, email, SMS, provider transport, provider enforcement, campaign dispatch, queue/outbox customer send or customer communication was invoked. No deployment beyond API/web occurred.
