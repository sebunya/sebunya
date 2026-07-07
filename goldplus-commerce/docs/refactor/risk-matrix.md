# Risk Matrix

Protected systems touched: NO production code mutated.
Protected systems inspected: YES, read-only audit only.

| Severity | Risk | Evidence | Impact | Probability | Mitigation |
| --- | --- | --- | --- | --- | --- |
| Critical | Storefront edge outage from API failure | `docker-compose.production.yml:158`, `docker-compose.production.yml:211` | Site offline instead of degraded | High | Decouple Caddy/web from API readiness |
| Critical | Host port conflict | `docker-compose.production.yml:70`, `docker-compose.production.yml:243` | Compose deployment failure | High | Rebind Grafana or API host port |
| Critical | Admin data exposure | `governance.ts:147`, `governance.ts:385` | Sensitive operational data readable | High | Add auth/permissions and SSR token forwarding |
| High | Metrics hangs during Redis outage | `metrics.ts:136` and failing `Observability.test.ts` | Monitoring endpoint unavailable | Medium | Bound queue metrics with timeout/cache |
| High | Vulnerable dependencies | `pnpm audit --audit-level=high` | Security exposure, CI audit failure | High | Dedicated upgrade pass |
| High | CORS open to all origins | `app.ts:41` | Browser attack surface wider than needed | Medium | Environment origin allowlist |
| High | Request tracing registered after routes | `app.ts:90`, `app.ts:114` | Missing correlation IDs in route logic | Medium | Move request ID middleware before route registration |
| High | Application imports infrastructure | telemetry use cases | Harder testing and unsafe coupling | High | Introduce ports and inject adapters |
| Medium | Checkout local draft in production | `checkout.astro:138` | User confusion and support load | Medium | Feature-flag or strengthen production UX |
| Medium | Service worker offline strategy is shallow | `sw.js:48` | Offline page, limited static recovery | Medium | Define cache policy for safe catalog/static pages |
| Medium | Lint gate fails | `apps/web/src/lib/telemetry.ts` | CI blocked | High | One-line lint fix |
| Medium | Astro templates not fully checked | `apps/web/package.json` | Template defects can slip through | Medium | Add Astro checker |
| Medium | Missing payment asset | `BaseLayout.astro:258` | Broken footer image | High | Add asset or remove reference |
| Medium | Routes are fat | commerce/admin product routes | Hard to test contracts | High | Extract validators/use cases incrementally |
| Medium | Health uses broad Registry | health/metrics routes | Diagnostics coupled to unrelated adapters | Medium | Narrow health-specific registry |
| Low | Docs sprawl | `docs/` | Hard to find canonical docs | High | Add docs index later |

## Blast-Radius Guidance

- Low blast radius: lint-only fixes, missing asset, test-only assertions, docs index.
- Medium blast radius: route auth additions, request ID middleware order, metrics timeout handling.
- High blast radius: compose dependency changes, dependency major upgrades, telemetry ports.
- Protected-system blast radius: any change touching recommendation scoring, rules, placements, target scopes, rails, payloads, storage keys, analytics, cache behavior.

## Pass 2 Availability Risk Confirmation - 2026-06-02

Mode: PLANNING ONLY. Protected systems touched: NO.

| Risk | Status | Evidence | Planning decision |
| --- | --- | --- | --- |
| Caddy depends on web/API health before starting. | Confirmed | `docker-compose.production.yml:201-215` and compose config show Caddy `depends_on` web and API with `service_healthy`. | Remove Caddy app dependencies so edge binds `80/443` independently. |
| Web depends on API readiness before becoming available. | Confirmed | `docker-compose.production.yml:151-160` gates web on API `service_healthy`. | Remove web dependency on API health. |
| API strict env validation can crash startup and cascade to storefront outage. | Confirmed | `server.ts:1` imports config; `env.ts:126-156` throws on missing/weak production env. Current compose chain lets that block API, then web, then Caddy. | Keep strict validation, but decouple web/Caddy from API startup. |
| Caddy cannot serve a controlled fallback when upstreams are down. | Confirmed | `Caddyfile:40-45` and `Caddyfile:66-74` are plain reverse proxies without fallback handlers. | Add Caddy-level fallback handlers and static fallback asset. |
| API and Grafana both bind host port `3000`. | Confirmed | `docker-compose.production.yml:70-71` and `docker-compose.production.yml:240-244`. | Remove or localhost-bind API host port; move Grafana to localhost/admin-only non-conflicting port. |
| API is publicly exposed instead of internally via Caddy. | Confirmed | API publishes host `3000:3000` while Caddy also routes `api.shopgoldplus.com` to `api:3000`. | Prefer internal Docker networking and public access through Caddy only. |
| Grafana is publicly exposed instead of internal/admin-only. | Confirmed | `docker-compose.production.yml:240-244` publishes Grafana host port `3000`. | Bind to localhost or admin-only route/network. |
| `/health/deep` is used for liveness/restart decisions. | Disproved in compose; present in docs. | API healthcheck uses `/health/live` at `docker-compose.production.yml:120-125`. Docs mention `/health/deep` for diagnostics at `production-verification.md:26-32` and `outage-response-runbook.md:20-24`. | Keep `/health/deep` diagnostic only and update docs wording if needed. |
| `/health/ready` depends on optional systems that should not block startup. | Partially confirmed. | `health.ts:23-67` readiness fails on Postgres error and Redis unhealthy; Zepto/SMS config is reported but does not fail readiness. | Do not use readiness to gate Caddy/web. Consider Redis readiness semantics only in a later API availability pass. |
| SSL renewal could be blocked by service dependency ordering. | Confirmed startup risk; persistence is present. | Caddy depends on app health at `docker-compose.production.yml:211-215`; Caddy data/config volumes exist at `docker-compose.production.yml:207-210` and `284-287`. | Remove Caddy dependencies; keep certificate storage volumes. |
| Service worker `/offline` masks production outage states. | Confirmed UX risk. | `sw.js:48-52` falls navigation back to `/offline`; `offline.astro:10-13` describes the cause as likely device offline. | Prefer Caddy edge fallback for production outages; service worker copy can be improved later if approved. |
| Metrics and observability endpoints remain available during partial outage. | Partially confirmed after Pass 1. | `metrics.ts:9`, `141-160`, and `210-286` bound DB/queue collection and expose degraded metrics; API must still start first. | Keep `/metrics` smoke in Pass 2 verification. |
| Docker restart policies could create restart storms. | Confirmed risk. | Services use `restart: always`; API strict env failure can exit before server start. | Decouple edge first; review restart policy later if repeated crash loops remain. |
| Startup ordering could cause cascading failure. | Confirmed | Current chain is `postgres` -> `pgbouncer` -> `api` -> `web` -> `caddy`, plus `redis` -> `api`. | Break chain at Caddy and web; consider API Redis dependency later. |
| No static maintenance fallback independent of API/web app. | Confirmed | No Caddy fallback/static file_server path exists in `Caddyfile`; `/offline` is served by Astro/service worker, not edge-level Caddy. | Add Caddy-served static fallback in implementation. |

## Pass 2 Risk Update - 2026-06-03

Protected systems touched: NO.

| Risk | Pass 2 status | Remaining risk |
| --- | --- | --- |
| Caddy blocked by API/web health. | Mitigated by removing Caddy `depends_on` on app health. | Caddy runtime config still needs production smoke validation. |
| Web blocked by API health. | Mitigated by removing web `depends_on` on API health. | Web SSR may still degrade if API calls fail, but edge fallback is no longer gated by API health. |
| API/Grafana host port conflict. | Mitigated by removing API host port and moving Grafana to `127.0.0.1:3001:3000`. | Operators must use localhost/VPN/SSH tunnel for Grafana. |
| Internal service public exposure. | Reduced by moving DB/Redis/PgBouncer/PgHero/Prometheus/node-exporter bindings to localhost and removing API/web host ports. | Host firewall policy should still be reviewed in production. |
| No static Caddy fallback. | Mitigated with `ops/caddy-fallback/maintenance.html` and Caddy error handlers. | Degraded smoke tests are still required before production rollout. |
| SSL renewal blocked by app dependency ordering. | Reduced because Caddy no longer waits for API/web health and keeps persisted cert volumes. | External DNS/firewall and ACME reachability still require production verification. |
| Service worker offline page masking outages. | Not changed by scope. | Caddy fallback now handles edge/upstream outage; service worker copy can be improved later if approved. |

## Pass 2B Risk Update - 2026-06-03

Protected systems touched: NO.

| Risk | Pass 2B status | Remaining risk |
| --- | --- | --- |
| Caddy blocked by API/web health. | Compose topology confirms Caddy has no `depends_on` on API or web and still binds public `80/443`. | Runtime startup still requires successful Caddy image validation. |
| Caddy fallback path mismatch. | Compose config confirms `./ops/caddy-fallback` mounts read-only to `/srv/caddy-fallback`; the fallback file exists and is readable. | Full runtime proof is blocked until the disposable Caddy container can run. |
| Storefront fallback masks outage as success. | Fallback file copy is honest degraded/temporary-unavailable messaging; Caddyfile intends status `503`. | Caddyfile status directive still needs production-image validation. |
| API fallback masks outage as success. | Caddyfile fallback body is JSON-shaped, degraded, and configured with status `503`, without stack traces or upstream internals. | Caddyfile directive syntax still needs production-image validation. |
| API/Grafana host port conflict. | Resolved in compose: API has no host port; Grafana is `127.0.0.1:3001:3000`. | None identified in static topology review. |
| Internal service public exposure. | API/web have no host ports; Postgres, Redis, PgBouncer, PgHero, Prometheus, node-exporter, and sGTM are localhost-bound, not public. | Some infrastructure services still have localhost host bindings rather than Docker-network-only bindings. |
| Docs drift from config. | Runbooks and verification docs match the current domains, fallback behavior, TLS persistence, port exposure, rollback steps, and remaining risks. | Keep docs updated after successful Caddy runtime validation. |

## Pass 2D Deferred Validation Risk Note - 2026-06-03

Protected systems touched: NO.

| Risk | Pass 2D status | Next action |
| --- | --- | --- |
| Local Docker unavailable. | Still blocked at `unix:///var/run/docker.sock`. | Run `brew install qemu && colima start && docker info`, or validate on Hetzner. |
| Colima cannot start. | Colima is installed but stopped; startup failed because `qemu-img` is missing. | Install QEMU locally before retrying Colima. |
| Caddy runtime validation remains unproven. | Deferred validation runbook added at `docs/caddy-runtime-validation-runbook.md`. | Run `caddy:2-alpine caddy validate` with Compose-matching mounts when Docker is available. |
| Pass 3 pressure before Pass 2 closure. | Explicitly blocked. | Do not approve Pass 3 until Caddy validation and Compose config both pass. |

## Pass 3 Risk Update - 2026-06-03

Protected systems touched: NO.

| Risk | Pass 3 status | Remaining risk |
| --- | --- | --- |
| Unauthenticated governance admin reads. | Mitigated and verified by targeted governance-admin read protection tests. | Keep future `/governance/admin/*` routes behind the same auth boundary. |
| Admin SSR helper omits auth token. | Mitigated by making `tryFetchAdminList` token-aware and passing existing admin session tokens from caller pages. | Pages using direct `fetch` already send tokens; keep future helper callers token-aware. |
| Regression in order admin routes. | Existing order permissions were preserved while moving auth to the admin boundary; existing order admin tests passed. | None identified. |
| Validation blocked by host disk pressure. | Initial targeted Vitest run failed before tests executed due `ENOSPC`; reruns passed with low-worker Vitest settings. | Host disk still needs cleanup to avoid future tool failures. |
