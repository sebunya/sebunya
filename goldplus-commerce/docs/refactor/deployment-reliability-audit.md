# Deployment Reliability Audit

Protected systems touched: NO production code mutated.
Protected systems inspected: YES, recommendation deployment/cache behavior was not changed.

## Top 10 Production Reliability Risks

| Severity | Risk | Evidence | Impact | Fix direction |
| --- | --- | --- | --- | --- |
| Critical | Caddy waits on API health | `docker-compose.production.yml:211` | Edge unavailable when API unhealthy. | Let Caddy start independently. |
| Critical | Web waits on API health | `docker-compose.production.yml:158` | Static storefront unavailable when API unhealthy. | Let web start independently. |
| Critical | API and Grafana host port conflict | `docker-compose.production.yml:70`, `docker-compose.production.yml:243` | Deployment bind failure. | Rebind Grafana. |
| High | API health only checks liveness in container healthcheck | `docker-compose.production.yml:120` | Service may be marked healthy while DB/Redis readiness is bad. | Separate liveness for restart, readiness for routing. |
| High | Metrics hangs without Redis | `metrics.ts:136` and test failure | Monitoring unreliable during incident. | Bound queue metric collection. |
| High | Strict env validation plus compose dependency chain | `env.ts:126`, compose dependencies | Single missing env can collapse storefront. | Keep validation, decouple edge. |
| Medium | Grafana default admin fallback | `docker-compose.production.yml:246` | Weak default if env absent. | Require explicit secret or bind internally. |
| Medium | PgHero exposed on host port 8080 | `docker-compose.production.yml:220` | Admin DB tooling exposed if host firewall weak. | Bind localhost/VPN only. |
| Medium | No SSL expiry monitor observed | docs/compose | TLS expiry can recur. | Add external expiry monitor and alert. |
| Medium | sGTM container health depends on curl availability | `docker-compose.production.yml:267` | Healthcheck may fail if image lacks curl. | Verify or use compatible check. |

## Failure Isolation Proposal

- Caddy starts with no app dependencies.
- Web starts with no API dependency and uses SSR timeouts/fallbacks.
- API starts only with valid core env and dependency readiness.
- Caddy proxies `/api` or API subdomain to API with clear 502/503 fallback.
- Maintenance page is static and mounted at Caddy level.
- Prometheus/Grafana are not publicly exposed without auth/network restriction.

## Verification Plan For Deployment Pass

1. `docker compose -f docker-compose.production.yml config`.
2. Start Caddy/web with API deliberately disabled.
3. Verify `shopgoldplus.com` equivalent local host returns storefront or maintenance page.
4. Verify API failure does not block TLS/edge startup.
5. Verify `/health/live`, `/health/ready`, `/metrics` behavior under DB/Redis down.
6. Verify rollback restores previous compose behavior if needed.

## Pass 2 Planning Report - 2026-06-02

Mode: PLANNING ONLY. No production code or deployment config changed.

Protected systems touched: NO.

### Docker Dependency Chain Map

Current compose chain:

1. `postgres` starts and must pass `pg_isready`.
2. `pgbouncer` waits for `postgres` `service_healthy`.
3. `redis` starts and must pass `redis-cli ping`.
4. `api` waits for both `pgbouncer` and `redis` `service_healthy`.
5. `web` waits for `api` `service_healthy`.
6. `caddy` waits for both `web` and `api` `service_healthy`.

Impact: an API startup failure can prevent both the storefront container and the public edge from starting.

### Reverse Proxy Routing Map

| Host | Current Caddy behavior | Upstream dependency |
| --- | --- | --- |
| `shopgoldplus.com` | Reverse proxy to `web:4321`. | Web container. |
| `api.shopgoldplus.com` | Reverse proxy to `api:3000`. | API container. |
| `metrics.shopgoldplus.com` | Reverse proxy to `sgtm-production:8080`; debug requests to `sgtm-preview:8080`. | sGTM containers. |

There is no Caddy-level `handle_errors`, static fallback root, or independent maintenance response.

### Port Exposure Table

| Service | Current host exposure | Planning assessment |
| --- | --- | --- |
| Caddy | `80:80`, `443:443` | Correct public exposure, but startup is gated by app health. |
| API | `3000:3000` | Public host exposure is unnecessary if Caddy routes to `api:3000` internally. Also conflicts with Grafana. |
| Web | `4321:4321` | Public host exposure is likely unnecessary if Caddy routes to `web:4321` internally. |
| Grafana | `3000:3000` | Conflicts with API and should be localhost/admin-only. |
| Prometheus | `9090:9090` | Operational surface; consider localhost/admin-only after Pass 2 minimal fix. |
| PgHero | `8080:8080` | DB admin surface; should not be public. |
| Postgres | `5432:5432` | DB surface; consider localhost/private network only. |
| PgBouncer | `6432:6432` | DB proxy surface; consider localhost/private network only. |
| Redis | `6379:6379` | Queue/cache surface; consider localhost/private network only. |
| node-exporter | `9100:9100` | Metrics surface; consider localhost/private network only. |
| sGTM production/preview | `127.0.0.1:8080`, `127.0.0.1:8081` | Already localhost-bound. |

### Health Endpoint Usage Map

| Endpoint | Code behavior | Current usage | Planning decision |
| --- | --- | --- | --- |
| `/health/live` | Process-only JSON liveness. | API compose healthcheck uses it. | Keep for container liveness. |
| `/health/ready` | Checks Postgres via system health and Redis via queue service; returns 503 if unready. | Docs tell operators to check it. | Keep for readiness and monitoring, not Caddy/web startup gating. |
| `/health/deep` | Diagnostic DB saturation, outbox lag, Redis, and sGTM checks. | Docs tell operators to check it; not used by compose liveness. | Keep diagnostic only. |
| `/metrics` | Prometheus metrics with bounded optional DB/queue collection after Pass 1. | Docs verify it. | Keep in degraded-mode verification. |

### Startup Failure Chain

1. Missing or weak production env causes `validateEnv()` to throw.
2. API imports env before server startup, so API may never expose `/health/live`.
3. Web currently waits for API health, so web does not become available.
4. Caddy currently waits for both web and API health, so Caddy may not bind `80/443`.
5. With Caddy not bound, TLS issuance/renewal and controlled fallback responses can fail.
6. Users see connection refused, expired TLS, or an uncontrolled offline response rather than a stable maintenance page.

### Minimal Pass 2 Implementation Shape

- Break Caddy dependency on API/web health first.
- Add Caddy-level fallback response for storefront and API upstream failure.
- Break web dependency on API health.
- Remove API/Grafana host port conflict and minimize public host exposure.
- Keep strict API env validation.
- Keep `/health/live`, `/health/ready`, and `/health/deep` semantics unchanged unless implementation testing proves otherwise.

### Rollback Plan

- Revert `docker-compose.production.yml` and `Caddyfile` to the previous versions.
- Remove fallback asset mount and fallback asset file if added.
- Re-run `docker compose -f docker-compose.production.yml config`.
- Restore previous port mappings only if rollback requires the original exposure.
- Verify Caddy, web, API, `/health/live`, `/health/ready`, and `/metrics`.

### Approval Checkpoint

Pass 2 implementation is not started. Approval is required before changing compose, Caddy, fallback assets, runbooks, tests, or production code.

## Pass 2 Implementation Report - 2026-06-03

Protected systems touched: NO.

### New Dependency Chain

- Caddy has no application health dependencies and can start independently.
- Web has no API health dependency and can start independently.
- API still waits for PgBouncer and Redis health.
- PgBouncer still waits for Postgres health.
- Caddy still binds public ports `80` and `443`.

### New Reverse Proxy Behavior

| Host | Normal behavior | Degraded behavior |
| --- | --- | --- |
| `shopgoldplus.com` | Reverse proxy to `web:4321`. | Caddy serves static `503` fallback if the web upstream is unavailable. |
| `www.shopgoldplus.com` | Reverse proxy to `web:4321`. | Caddy serves static `503` fallback if the web upstream is unavailable. |
| `api.shopgoldplus.com` | Reverse proxy to `api:3000`. | Caddy serves controlled `503` JSON if the API upstream is unavailable. |
| `metrics.shopgoldplus.com` | Reverse proxy to sGTM production/preview containers. | Existing behavior unchanged. |

### New Port Exposure

| Service | Host exposure |
| --- | --- |
| Caddy | `80:80`, `443:443` |
| API | None |
| Web | None |
| Grafana | `127.0.0.1:3001:3000` |
| Prometheus | `127.0.0.1:9090:9090` |
| PgHero | `127.0.0.1:8082:8080` |
| Postgres | `127.0.0.1:5432:5432` |
| PgBouncer | `127.0.0.1:6432:6432` |
| Redis | `127.0.0.1:6379:6379` |
| node-exporter | `127.0.0.1:9100:9100` |
| sGTM production | `127.0.0.1:8080:8080` |
| sGTM preview | `127.0.0.1:8081:8080` |

### Healthcheck Alignment

- API container healthcheck remains `/health/live`.
- Web healthcheck remains HTTP root.
- `/health/ready` remains dependency readiness and is not used for Caddy/web startup gating.
- `/health/deep` remains diagnostic only.

### Validation

- `docker compose -f docker-compose.production.yml config`: passed.
- `pnpm run typecheck`: passed.
- `pnpm test:architecture`: passed.
- `pnpm test`: passed.
- `pnpm run build`: passed.
- `pnpm test:unit`: passed.

### Rollback

1. Restore previous `docker-compose.production.yml` and `Caddyfile`.
2. Remove `ops/caddy-fallback/maintenance.html` and the fallback mount if desired.
3. Run `docker compose -f docker-compose.production.yml config`.
4. Redeploy only during an approved deployment or rollback window.
5. Verify Caddy, storefront, API health endpoints, `/metrics`, and TLS validity.

## Pass 2B Edge Runtime Validation Attempt - 2026-06-03

Protected systems touched: NO.

### Static Topology Evidence

- Compose config validation passed.
- Caddy uses production image `caddy:2-alpine`.
- Caddy has no API/web `depends_on` and can be scheduled independently by Compose topology.
- Caddy public ports are `80:80` and `443:443`.
- Caddy fallback mount is `./ops/caddy-fallback:/srv/caddy-fallback:ro`.
- Caddy certificate storage remains persisted through `caddy_data:/data` and `caddy_config:/config`.
- API and web have no public host ports and remain reachable to Caddy over the Docker network as `api:3000` and `web:4321`.
- Grafana no longer conflicts with API on host port `3000`; Grafana is `127.0.0.1:3001:3000`.
- Postgres, Redis, PgBouncer, PgHero, Prometheus, node-exporter, and sGTM host bindings are localhost-only.

### Fallback Evidence

- `ops/caddy-fallback/maintenance.html` exists and is readable.
- Storefront fallback copy is dependency-free, branded, temporary-unavailable messaging and does not claim normal storefront, checkout, or order success.
- API fallback body is controlled JSON with `ok: false`, `status: degraded`, service name, and temporary-unavailable messaging.
- Both storefront and API fallbacks are configured as `503` responses in `Caddyfile`.
- `metrics.shopgoldplus.com` still routes standard sGTM traffic to `sgtm-production:8080` and preview/debug traffic to `sgtm-preview:8080`.

### Blocked Runtime Evidence

The approved Caddy validation command was attempted:

```bash
docker run --rm -v "$PWD/Caddyfile:/etc/caddy/Caddyfile:ro" -v "$PWD/ops/caddy-fallback:/srv/caddy-fallback:ro" caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

It could not complete because the local Docker daemon was not reachable at `/var/run/docker.sock`. Pass 2B remains blocked on successful production-image Caddyfile validation.

## Pass 2D Deferred Hetzner Validation Preparation - 2026-06-03

Protected systems touched: NO.

Pass 2D made documentation/runbook changes only. No production code, Docker/Caddy config, environment files, package files, lockfiles, migrations, deployment commands, production restarts, or Compose up/down actions were performed.

### Blocker Summary

- Local Docker daemon remains unavailable at `unix:///var/run/docker.sock`.
- Active local Docker context observed during Pass 2C was `default`.
- Colima is installed at `/opt/homebrew/bin/colima` but was not running.
- `colima start` failed because `qemu-img` was missing.
- Manual local unblock command: `brew install qemu && colima start && docker info`.

### Prepared Validation Paths

- Local Mac validation: unblock Docker/Colima, confirm Docker context, validate `Caddyfile` with `caddy:2-alpine` and the Compose fallback mount `/srv/caddy-fallback`, check fallback file presence/readability, run Compose config, then run the required quality gates.
- Hetzner validation: from `/opt/goldplus/goldplus-commerce` or the actual production repo path, run Docker diagnostics, disposable `caddy:2-alpine caddy validate`, fallback checks, and Compose config without restarting production containers or running `docker compose up/down`.

Detailed runbook: `docs/caddy-runtime-validation-runbook.md`.

Pass 2 remains blocked until production-image Caddy validation succeeds. Pass 3 is not approved.
