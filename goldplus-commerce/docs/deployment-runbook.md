# Deployment Runbook & Release Engineering

This runbook guides safe production releases for the GoldPlus Commerce OS Docker/Caddy stack.

## 1. Availability Model

Production now follows an edge-first availability model:

- Caddy starts independently and binds ports `80` and `443`.
- Caddy does not depend on API or web health to start.
- Caddy certificate storage is persisted in `caddy_data` and `caddy_config`.
- Web starts without waiting for API readiness.
- API still uses strict production env validation and meaningful healthchecks.
- When web is unreachable, Caddy serves a static `503` storefront fallback.
- When API is unreachable, Caddy serves a controlled `503` JSON fallback.

## 2. Pre-Deployment Checks

Before deploying, run the local gates:

```bash
pnpm lint
pnpm run typecheck
pnpm test:architecture
pnpm test
pnpm run build
```

Validate the compose model:

```bash
docker compose -f docker-compose.production.yml config
```

## 3. Maintenance Mode For Risky Releases

If a release involves destructive database migrations or schema changes, enable maintenance write-freeze before deployment:

```bash
curl -X POST https://api.shopgoldplus.com/admin/deployment/maintenance \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'
```

Verify write requests return `503` while read-only routes remain available where expected.

## 4. Shadow Traffic Testing

Before routing live users to a new code release, optionally mirror a small percentage of traffic to a shadow environment:

```bash
curl -X POST https://api.shopgoldplus.com/admin/deployment/shadow-traffic \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"ratio": 0.01}'
```

Start at `0.01`, then increase only after logs and metrics remain clean.

## 5. Rolling Container Deployment

Deploy only during an approved release window:

```bash
docker compose -f docker-compose.production.yml up -d --build --remove-orphans
```

Boot behavior:

- Caddy can start immediately and bind `80/443`.
- Postgres and Redis start independently.
- PgBouncer waits for Postgres health.
- API waits for PgBouncer and Redis health.
- Web no longer waits for API health.
- Caddy serves controlled fallback responses if API or web are unavailable.

## 6. Port Exposure

| Service | Host exposure | Notes |
| --- | --- | --- |
| Caddy | `80:80`, `443:443` | Public edge only. |
| API | None | Internal Docker network; Caddy routes to `api:3000`. |
| Web | None | Internal Docker network; Caddy routes to `web:4321`. |
| Grafana | `127.0.0.1:3001:3000` | Local/admin-only and no longer conflicts with API. |
| Prometheus | `127.0.0.1:9090:9090` | Local/admin-only. |
| PgHero | `127.0.0.1:8082:8080` | Local/admin-only. |
| Postgres | `127.0.0.1:5432:5432` | Local/admin-only. |
| PgBouncer | `127.0.0.1:6432:6432` | Local/admin-only. |
| Redis | `127.0.0.1:6379:6379` | Local/admin-only. |
| node-exporter | `127.0.0.1:9100:9100` | Local/admin-only. |
| sGTM production | `127.0.0.1:8080:8080` | Local-only. |
| sGTM preview | `127.0.0.1:8081:8080` | Local-only. |

## 7. Post-Deployment Verification

Normal mode:

```bash
curl -I https://shopgoldplus.com
curl -I https://www.shopgoldplus.com
curl -i https://api.shopgoldplus.com/health/live
curl -i https://api.shopgoldplus.com/health/ready
curl -s https://api.shopgoldplus.com/metrics | grep -E "goldplus_container_|goldplus_db_|goldplus_metrics_"
curl -I https://metrics.shopgoldplus.com/healthy
```

TLS:

```bash
curl -Iv https://shopgoldplus.com
curl -Iv https://www.shopgoldplus.com
curl -Iv https://api.shopgoldplus.com/health/live
```

Degraded mode, during approved smoke testing only:

- API unavailable: Caddy remains bound to `80/443` and API routes return controlled `503` JSON.
- Web unavailable: Caddy remains bound to `80/443` and storefront routes return the static `503` fallback page.

## 8. Deactivate Maintenance Mode

After verification:

```bash
curl -X POST https://api.shopgoldplus.com/admin/deployment/maintenance \
  -H "Authorization: Bearer <ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"enabled": false}'
```

## 9. Rollback

If the release fails:

1. Restore the prior `docker-compose.production.yml` and `Caddyfile`.
2. Remove the fallback mount/file if this release introduced it.
3. Re-run:

   ```bash
   docker compose -f docker-compose.production.yml config
   ```

4. Redeploy the last stable version during the approved rollback window.
5. Verify `shopgoldplus.com`, `api.shopgoldplus.com/health/live`, `api.shopgoldplus.com/health/ready`, `/metrics`, and TLS validity.
