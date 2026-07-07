# Phased Implementation Plan

Protected systems touched: NO production code mutated.
Protected systems inspected: YES, read-only audit only.

## Approval Rule

No production code changes should begin until a pass below is explicitly approved. Each pass should be one small diff set, tested before the next pass starts.

## Pass 1: Restore CI Baseline

- Objective: fix current non-behavioral gate failures.
- Inspect: `apps/web/src/lib/telemetry.ts`, `tests/unit/Observability.test.ts`, `apps/api/src/interfaces/http/routes/metrics.ts`.
- Change: one lint fix; make `/metrics` bounded when Redis is unavailable.
- Protected systems touched: NO.
- Expected behavior change: `/metrics` should return promptly with degraded queue metrics instead of hanging.
- Tests: `pnpm lint`, `pnpm test:unit -- tests/unit/Observability.test.ts`, `pnpm test`, `pnpm build`.
- Rollback: revert exact files.
- Risk: Medium because metrics behavior changes, but user-facing commerce behavior should not.

## Pass 2: Close Admin Read Exposure

- Objective: protect `/governance/admin/*` read endpoints and keep admin SSR working.
- Inspect: `apps/api/src/interfaces/http/routes/governance.ts`, `apps/web/src/lib/api.ts`, admin pages using `tryFetchAdminList`.
- Change: add `authMiddleware` and `requirePermissions`; pass token from SSR helper/pages.
- Protected systems touched: NO.
- Expected behavior change: unauthenticated API calls return 401/403.
- Tests: add route tests for each admin endpoint; run `pnpm test:unit`, `pnpm test:architecture`.
- Rollback: revert route/helper changes.
- Risk: High because it changes admin access behavior, but it fixes a security bug.

## Pass 3: Deployment Failure Isolation

- Objective: prevent API failure from collapsing storefront and Caddy.
- Inspect: `docker-compose.production.yml`, `Caddyfile`, `Dockerfile.web`, `apps/web/src/pages/offline.astro`.
- Change: remove Caddy hard dependency on API readiness, remove web dependency on API health, fix host port conflict, define maintenance fallback.
- Protected systems touched: NO.
- Expected behavior change: web/Caddy can start when API is down; API routes fail independently.
- Tests: `docker compose -f docker-compose.production.yml config`, local degraded-start smoke, build.
- Rollback: restore previous compose/Caddy files.
- Risk: High, deployment-facing.

## Pass 4: Request Context And Error Taxonomy

- Objective: ensure request IDs/tracing exist before routes and middleware.
- Inspect: `apps/api/src/interfaces/http/app.ts`, middleware, tests.
- Change: move request ID middleware before routes; standardize error envelopes where low risk.
- Protected systems touched: NO unless recommendation route tests are only read.
- Expected behavior change: headers consistently include correlation IDs.
- Tests: route header tests, `pnpm test:unit`, `pnpm test:architecture`.
- Rollback: revert app wiring.
- Risk: Medium.

## Pass 5: Dependency Security Upgrade

- Objective: address audit failures.
- Inspect: root/app package files and lockfile.
- Change: upgrade Vitest, Astro/devalue, Drizzle, and replace or isolate `xlsx`.
- Protected systems touched: NO unless tests expose type changes.
- Expected behavior change: none intended.
- Tests: full gates, dependency audit, build, smoke.
- Rollback: restore package files and lockfile.
- Risk: High due package upgrades.

## Pass 6: Telemetry Port Extraction

- Objective: reduce application-layer infrastructure imports.
- Inspect: telemetry use cases, DB outbox repository, identity repository, queue service.
- Change: introduce ports for telemetry outbox enqueue and identity enrichment.
- Protected systems touched: NO, but telemetry events are operationally sensitive.
- Expected behavior change: none.
- Tests: telemetry unit tests, architecture tests tightened.
- Rollback: revert new ports/adapters.
- Risk: Medium.

## Pass 7: Frontend Accessibility And Asset Hygiene

- Objective: fix broken asset and obvious semantic/accessibility gaps without redesign.
- Inspect: `BaseLayout.astro`, `Header.astro`, checkout/forms, shop filters.
- Change: add/remove missing Airtel asset reference; ensure controls have labels/states.
- Protected systems touched: NO.
- Expected behavior change: improved rendering/accessibility only.
- Tests: build, visual smoke, axe if available.
- Rollback: revert exact frontend files.
- Risk: Low.

## Pass 8: Route Thinness

- Objective: move repeated validation and orchestration from large route files into use cases/validators.
- Inspect: `commerce.ts`, `admin/products.ts`, `governance.ts`.
- Change: extract one route group at a time.
- Protected systems touched: NO.
- Expected behavior change: none.
- Tests: route contract tests and existing unit tests.
- Rollback: revert pass.
- Risk: Medium.

## Pass 1 Completion Notes - 2026-06-02

- Scope completed: fixed the `prefer-const` lint error in `apps/web/src/lib/telemetry.ts`; bounded optional DB and BullMQ collection in `apps/api/src/interfaces/http/routes/metrics.ts`; added degraded-state collection metrics and scrape duration metrics; updated the existing `/metrics` observability test.
- Protected systems touched: NO.
- Verification: `pnpm test:unit -- tests/unit/Observability.test.ts` passed; due current script behavior it ran all unit tests, 55 files and 375 tests. `GET /metrics` completed in about 813 ms with DB unavailable.
- Verification: `pnpm test:architecture` passed, 10 tests.
- Verification: `pnpm --filter @goldplus/web lint` passed with 0 errors and 26 existing warnings.
- Verification: `pnpm --filter @goldplus/api exec eslint src/interfaces/http/routes/metrics.ts` passed with 0 errors and 2 existing unused-catch warnings.
- Note: full `pnpm lint` still fails on existing API lint errors outside Pass 1 scope.
- Rollback: revert `apps/web/src/lib/telemetry.ts`, `apps/api/src/interfaces/http/routes/metrics.ts`, `tests/unit/Observability.test.ts`, and these Pass 1 doc notes.

## Pass 1B Completion Notes - 2026-06-02

- Scope completed: fixed the 12 remaining blocking API lint errors only.
- Files changed: `apps/api/src/application/use-cases/notifications/NotificationTemplateRenderer.ts`, `apps/api/src/infrastructure/db/client.ts`, `apps/api/src/infrastructure/deployment/DeploymentService.ts`, `apps/api/src/infrastructure/notifications/sms/PahappaCommsSmsAdapter.ts`, `apps/api/src/infrastructure/queues/QueueService.ts`, `apps/api/src/interfaces/http/routes/admin/notifications.ts`.
- Protected systems touched: NO.
- Lint fixes: `prefer-const`, `no-constant-condition`, `no-useless-escape`, and `@typescript-eslint/no-require-imports`.
- Gates run and passed: `pnpm lint`, `pnpm run typecheck`, `pnpm test:architecture`, `pnpm test`, `pnpm run build`, `pnpm test:unit`.
- Remaining warnings: existing lint warnings remain non-blocking; build still emits existing Sentry/Vite warnings.
- Recommended Pass 2: Production Availability Isolation, only after explicit approval.

## Pass 2 Planning Notes - 2026-06-02

Mode: PLANNING ONLY. No production code, Docker, Caddy, env, service worker, package, lockfile, test, deploy script, or migration files were changed.

Protected systems touched: NO.

Objective: isolate the public edge and storefront from API, database, Redis, and observability failures so one unhealthy service cannot make `shopgoldplus.com` unavailable.

### Current Availability Architecture

- Public edge: Caddy binds host ports `80` and `443` and proxies storefront, API, and telemetry hosts.
- Storefront route: `shopgoldplus.com` -> Caddy -> `web:4321`.
- API route: `api.shopgoldplus.com` -> Caddy -> `api:3000`.
- Telemetry route: `metrics.shopgoldplus.com` -> Caddy -> `sgtm-production:8080` or `sgtm-preview:8080`.
- Current dependency chain: `postgres` -> `pgbouncer` -> `api` -> `web` -> `caddy`, with `redis` also gating `api`.
- Current port conflict: API and Grafana both publish host port `3000`.

### Proposed Minimal Implementation Sequence

1. Caddy independence
   - Change `docker-compose.production.yml` so Caddy has no `depends_on` on `web` or `api`.
   - Expected behavior: Caddy starts, binds `80/443`, and renews TLS even when app upstreams are unhealthy.
   - Rollback: restore the prior Caddy `depends_on` block.

2. Static edge fallback
   - Add a small static fallback asset directory for Caddy and mount it read-only.
   - Update `Caddyfile` with controlled fallback behavior for upstream errors.
   - Storefront fallback should be a branded maintenance/service-unavailable page.
   - API fallback should be a JSON `503` response, not an HTML storefront page.
   - Rollback: remove the fallback mount and Caddy fallback handlers.

3. Web/API startup isolation
   - Remove the `web` service dependency on `api` health.
   - Keep API strict env validation, but stop API startup failure from gating web/Caddy startup.
   - Rollback: restore the prior `web.depends_on.api.condition: service_healthy` block.

4. Port exposure correction
   - Remove or localhost-bind API host port exposure because Caddy can reach `api:3000` over the Docker network.
   - Move Grafana away from public host `3000`, preferably `127.0.0.1:3001:3000` or an admin-only route/network.
   - Review PgHero, Prometheus, Postgres, Redis, and node-exporter host exposure as a follow-up hardening item.
   - Rollback: restore previous port mappings if needed.

5. Health-check and verification alignment
   - Keep `/health/live` as process-only liveness.
   - Keep `/health/ready` as dependency-aware readiness.
   - Keep `/health/deep` diagnostic only.
   - Do not use `/health/deep` for container liveness or restart decisions.
   - Update production verification docs after implementation to use `api.shopgoldplus.com` consistently.

### Exact Files Likely To Change During Implementation

| File | Proposed change | Behavior before | Behavior after | Blast radius |
| --- | --- | --- | --- | --- |
| `docker-compose.production.yml` | Remove Caddy app-health dependencies; remove web API-health dependency; fix API/Grafana host port conflict; add fallback mount if used. | Caddy can be blocked by web/API health; web can be blocked by API health; API and Grafana conflict on host port `3000`. | Edge can start independently; web can start independently; no host port conflict. | High, deployment only. |
| `Caddyfile` | Add Caddy-level fallback handling for web/API upstream failure. | Upstream outage returns uncontrolled proxy failure and requires upstream availability for useful response. | Caddy can return controlled fallback responses while keeping TLS edge alive. | High, reverse proxy only. |
| New fallback asset path, e.g. `ops/caddy-fallback/maintenance.html` | Provide static maintenance page served by Caddy. | No static fallback independent of API/web. | Branded fallback served directly from Caddy. | Low, static asset only. |
| `docs/production-verification.md` | Align domains and add degraded-start smoke checks. | Contained an outdated API host reference and no edge fallback smoke. | Checks `api.shopgoldplus.com`, `/health/live`, `/health/ready`, `/metrics`, SSL, and fallback behavior. | Low, docs only. |
| `docs/deployment-runbook.md` | Update boot-order guidance after compose changes. | Documents API-gated boot order. | Documents edge-first startup and controlled fallback. | Low, docs only. |

### Test Plan For Implementation Approval

1. `docker compose -f docker-compose.production.yml config`.
2. `pnpm run typecheck`.
3. `pnpm test:architecture`.
4. `pnpm test`.
5. `pnpm run build`.
6. Local degraded-start smoke after explicit implementation approval:
   - Caddy starts with API stopped or unhealthy.
   - Caddy starts with web stopped or unhealthy.
   - `shopgoldplus.com` equivalent returns storefront or controlled fallback.
   - `api.shopgoldplus.com/health/live` returns when API is up.
   - `api.shopgoldplus.com/health/ready` reflects dependency readiness.
   - `/metrics` remains available during partial outage.

### Manual Production Verification Plan

1. Confirm ports `80` and `443` are bound by Caddy before app health is green.
2. Verify TLS certificate validity and renewal storage persistence.
3. Verify `https://shopgoldplus.com` returns normal storefront when web is healthy.
4. Verify `https://shopgoldplus.com` returns controlled fallback when web is unhealthy.
5. Verify `https://api.shopgoldplus.com/health/live`, `/health/ready`, and `/metrics`.
6. Verify API failure does not stop storefront fallback or TLS responses.
7. Verify Grafana is not exposed on the same public host port as API.

Approval checkpoint: do not implement Pass 2 until the deployment-facing changes above are explicitly approved.

## Pass 2 Implementation Notes - 2026-06-03

Scope completed: Production Availability Isolation.

Protected systems touched: NO.

Files changed: `docker-compose.production.yml`, `Caddyfile`, `ops/caddy-fallback/maintenance.html`, `docs/production-verification.md`, `docs/deployment-runbook.md`, and approved refactor docs.

Implementation summary:

- Removed Caddy health-gated dependencies on `web` and `api`.
- Removed web health-gated dependency on `api`.
- Preserved API liveness healthcheck on `/health/live`.
- Preserved Caddy certificate volumes `caddy_data:/data` and `caddy_config:/config`.
- Added Caddy fallback mount `./ops/caddy-fallback:/srv/caddy-fallback:ro`.
- Added static dependency-free storefront fallback at `ops/caddy-fallback/maintenance.html`.
- Added Caddy `503` static storefront fallback for upstream edge errors.
- Added Caddy `503` JSON API fallback for upstream edge errors.
- Added `www.shopgoldplus.com` to the storefront Caddy route.
- Removed API and web public host ports; Caddy reaches them over the Docker network.
- Resolved API/Grafana host-port conflict by moving Grafana to `127.0.0.1:3001:3000`.
- Changed Postgres, Redis, PgBouncer, PgHero, Prometheus, and node-exporter host exposure to localhost-only.

Validation completed:

1. `docker compose -f docker-compose.production.yml config` passed.
2. `pnpm run typecheck` passed.
3. `pnpm test:architecture` passed, 10 tests.
4. `pnpm test` passed, 57 files and 385 tests.
5. `pnpm run build` passed.
6. `pnpm test:unit` passed, 55 files and 375 tests.

Remaining risks:

- Caddyfile runtime syntax was not separately validated with `caddy validate` because the approved command list did not include it.
- Degraded-mode smoke tests that stop API or web containers were documented but not executed because container restarts were not approved.
- API strict env validation can still stop API startup by design; the edge no longer depends on that startup.
- `/health/ready` still fails when required dependencies are unavailable; it must remain readiness, not liveness.

Recommended Pass 3: Governance/Admin Read Access Protection, pending explicit approval.

## Pass 2B Validation Attempt - 2026-06-03

Scope: Edge Runtime Validation and Degraded-Mode Proof. Protected systems touched: NO.

Files inspected: `docker-compose.production.yml`, `Caddyfile`, `ops/caddy-fallback/maintenance.html`, `docs/production-verification.md`, `docs/deployment-runbook.md`, and approved refactor docs.

Validation evidence:

- Compose config validation passed with `docker compose -f docker-compose.production.yml config`.
- Production Caddy image is `caddy:2-alpine`.
- Caddy runtime validation was attempted with `docker run --rm -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$PWD/ops/caddy-fallback:/srv/caddy-fallback:ro" caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`, but the local Docker daemon was not reachable at `/var/run/docker.sock`.
- Fallback file presence and readability checks passed for `ops/caddy-fallback/maintenance.html`.
- Fallback content sanity checks found GoldPlus branding and temporary-unavailability wording.
- Port review confirmed public exposure remains limited to Caddy `80:80` and `443:443`; API and web have no host ports; Grafana is localhost-bound at `127.0.0.1:3001:3000`; Postgres, Redis, PgBouncer, PgHero, Prometheus, node-exporter, and sGTM host bindings are localhost-only.
- Documentation check confirmed the canonical public hosts are `shopgoldplus.com`, `www.shopgoldplus.com`, `api.shopgoldplus.com`, and `metrics.shopgoldplus.com`.

Remaining blocker:

- Pass 2B cannot be fully closed until `caddy:2-alpine caddy validate` runs successfully in a disposable container or equivalent production-image validation environment.

## Pass 2D Deferred Validation Preparation - 2026-06-03

Scope: documentation preparation only. Protected systems touched: NO.

Docker blocker summary: local Docker daemon access remains unavailable at `unix:///var/run/docker.sock`. Colima is installed at `/opt/homebrew/bin/colima` but is not running; `colima start` failed because `qemu-img` is missing. Manual local unblock command: `brew install qemu && colima start && docker info`.

Prepared future validation paths:

- Local Mac path: fix Colima/QEMU, verify Docker context, run disposable `caddy:2-alpine caddy validate` with the Compose-matching mounts, then run fallback file checks, Compose config, and the required quality gates.
- Hetzner path: from the production repo path, run Docker diagnostics, disposable `caddy:2-alpine caddy validate`, fallback file checks, and Compose config without `docker compose up`, `docker compose down`, deployment, migrations, or production restarts.

Runbook added: `docs/caddy-runtime-validation-runbook.md`.

Pass 2 remains blocked until production-image Caddy validation succeeds. Pass 3 is not approved.

## Pass 3 Governance/Admin Read Protection - 2026-06-03

Scope: protect governance admin read surfaces and keep authenticated admin SSR working.

Protected systems touched: NO recommendation systems, recommendation scoring, recommendation placements, visitor intelligence, storefront rails, checkout/payment logic, database schema, migrations, package files, lockfiles, env files, Docker/Caddy config, or deployment commands were changed.

Implementation summary:

- Added a `/governance/admin/*` authentication boundary in `governance.ts`.
- Added permission checks to previously open governance admin reads: dashboard stats, products, payments, quotes, support tickets, and dealer applications.
- Preserved existing orders read/manage permission behavior.
- Updated `tryFetchAdminList` to forward an admin bearer token when provided.
- Updated admin SSR pages that use `tryFetchAdminList` to pass the existing session token.
- Added unit coverage for unauthenticated and insufficient-permission governance admin reads.

Validation status:

- Initial targeted Vitest execution hit host disk pressure (`ENOSPC`) while writing cache/results files.
- Validation was rerun with a low-worker Vitest profile and passed: targeted governance/order admin tests, architecture tests, full test suite, build, unit suite, typecheck, and lint all passed.

Pass 2 remains separately blocked on production-image Caddy validation.
