# Production Readiness Gaps

Protected systems touched: NO production code mutated.
Protected systems inspected: YES, read-only audit only.

## Critical Gaps

1. Caddy startup is gated by web and API health.
   - Evidence: `docker-compose.production.yml:211`.
   - Risk: expired TLS or API startup failure can make the storefront edge unavailable.

2. Web startup is gated by API health.
   - Evidence: `docker-compose.production.yml:158`.
   - Risk: static storefront cannot serve degraded pages when API fails.

3. API and Grafana both bind host port 3000.
   - Evidence: `docker-compose.production.yml:70`, `docker-compose.production.yml:243`.
   - Risk: deployment conflict.

4. `/metrics` is not isolated from Redis/queue availability.
   - Evidence: `metrics.ts:136`, failing `Observability.test.ts`.
   - Risk: monitoring can fail when the dependency it monitors is unhealthy.

5. Strict API env validation can cascade due deployment coupling.
   - Evidence: `env.ts:126`.
   - Risk: correct security behavior becomes storefront outage under current compose.

## Graceful Degradation Target

Desired production behavior:

- Caddy always starts when ports 80/443 are available.
- Caddy can serve a static maintenance fallback for web/API upstream failures.
- Web can start independently and render catalog fallback/offline pages.
- API can fail fast on invalid env without blocking Caddy or static web.
- `/health/live` stays cheap and dependency-free.
- `/health/ready` checks dependencies but does not gate the edge.
- `/metrics` returns bounded degraded metrics even if Redis or DB is unavailable.
- TLS renewal remains independent from app container health.

## Operational Gaps

- No observed blue/green or canary environment beyond compose deploy settings.
- No observed SSL expiry monitor or uptime check definition in repo.
- Prometheus service is present, but no config file was found in the inspected compose volume mapping.
- Grafana password has default fallback `${GRAFANA_PASSWORD:-admin}`.
- PgHero is exposed on host port 8080 and should be reviewed for network access controls.
- sGTM health uses `curl` in image healthcheck; confirm curl exists in image.

## Recommended First Reliability Fixes

1. Fix port conflict.
2. Remove web dependency on API health.
3. Remove Caddy dependency on API health.
4. Add Caddy fallback behavior for API/web upstream failure.
5. Bound `/metrics` queue collection.
6. Add smoke script that proves Caddy/web start while API is intentionally unhealthy.

