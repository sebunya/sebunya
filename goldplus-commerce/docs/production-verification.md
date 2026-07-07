# Production Verification & Post-Deployment Checklist

This checklist verifies normal operation and degraded-mode behavior for the GoldPlus production edge.

## Domains

- Storefront: `https://shopgoldplus.com`
- Storefront alias: `https://www.shopgoldplus.com`
- API: `https://api.shopgoldplus.com`
- Telemetry/sGTM: `https://metrics.shopgoldplus.com`

## Normal-Mode Verification

Run these checks after a release when all services are expected to be healthy:

```bash
curl -I https://shopgoldplus.com
curl -I https://www.shopgoldplus.com
curl -i https://api.shopgoldplus.com/health/live
curl -i https://api.shopgoldplus.com/health/ready
curl -s https://api.shopgoldplus.com/metrics | grep -E "goldplus_container_|goldplus_db_|goldplus_metrics_"
curl -I https://metrics.shopgoldplus.com/healthy
```

Expected results:

- `shopgoldplus.com` and `www.shopgoldplus.com` return the storefront when web is healthy.
- `/health/live` returns `200 OK` and process liveness only.
- `/health/ready` returns `200 OK` only when required API dependencies are ready.
- `/health/deep` remains diagnostic only and must not be used as a liveness/restart check.
- `/metrics` returns Prometheus-formatted metrics and may expose degraded collection metrics during partial outages.

## Degraded-Mode Verification

Do not restart production containers for this test unless an approved maintenance window exists. The expected behavior is documented here for controlled smoke testing.

### API Unavailable

Expected behavior:

- Caddy remains bound to ports `80` and `443`.
- `https://api.shopgoldplus.com/*` returns an honest degraded JSON fallback if the API upstream is unreachable.
- The fallback status is `503`.
- No stack traces, upstream internals, or fake success responses are returned.

Expected fallback shape:

```json
{
  "ok": false,
  "status": "degraded",
  "service": "goldplus-api",
  "message": "GoldPlus API is temporarily unavailable. Please retry shortly."
}
```

### Web Unavailable

Expected behavior:

- Caddy remains bound to ports `80` and `443`.
- `https://shopgoldplus.com` and `https://www.shopgoldplus.com` return a static GoldPlus fallback page.
- The fallback status is `503`.
- The fallback is dependency-free and does not claim checkout/orders are working.

### TLS

```bash
curl -Iv https://shopgoldplus.com
curl -Iv https://www.shopgoldplus.com
curl -Iv https://api.shopgoldplus.com/health/live
```

Expected results:

- Certificates are valid.
- Certificate expiry is visible in the TLS output.
- Caddy certificate storage remains persisted through `caddy_data` and `caddy_config`.
- TLS serving and renewal are not blocked by API or web health.

## Port Exposure

| Service | Host exposure | Purpose |
| --- | --- | --- |
| Caddy | `80:80`, `443:443` | Public HTTP/HTTPS edge. |
| API | None | Internal Docker network only; reached by Caddy as `api:3000`. |
| Web | None | Internal Docker network only; reached by Caddy as `web:4321`. |
| Grafana | `127.0.0.1:3001:3000` | Local/admin-only observability access. |
| Prometheus | `127.0.0.1:9090:9090` | Local/admin-only metrics access. |
| PgHero | `127.0.0.1:8082:8080` | Local/admin-only database dashboard access. |
| Postgres | `127.0.0.1:5432:5432` | Local/admin-only database access. |
| PgBouncer | `127.0.0.1:6432:6432` | Local/admin-only database proxy access. |
| Redis | `127.0.0.1:6379:6379` | Local/admin-only queue/cache access. |
| node-exporter | `127.0.0.1:9100:9100` | Local/admin-only host metrics access. |
| sGTM production | `127.0.0.1:8080:8080` | Local-only Caddy upstream/debug access. |
| sGTM preview | `127.0.0.1:8081:8080` | Local-only preview access. |

## Rollback Verification

If the Pass 2 deployment change must be rolled back:

1. Restore the previous `docker-compose.production.yml` and `Caddyfile`.
2. Remove the fallback asset mount if it was introduced by the release.
3. Validate the compose file:

   ```bash
   docker compose -f docker-compose.production.yml config
   ```

4. Verify `shopgoldplus.com`, `api.shopgoldplus.com/health/live`, `api.shopgoldplus.com/health/ready`, and `/metrics`.
