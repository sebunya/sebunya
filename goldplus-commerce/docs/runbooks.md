# GoldPlus Production Runbooks & Incident Response Guides

This document provides step-by-step procedures for operators, SREs, and engineers to diagnose, mitigate, and resolve production incidents on the GoldPlus commerce platform.

---

## 1. Subsystem Directory & Architecture Reference

The GoldPlus system comprises:
*   **Edge Proxy:** Caddy (Port 80/443) routing traffic and enforcing security headers.
*   **Storefront:** Astro SSR Web (Port 4321, 2 replicas).
*   **Core API:** Hono API Server (Port 3000, 2 replicas) handling checkout, catalog, and admin queries.
*   **Background Jobs:** Redis (Port 6379) + BullMQ Worker consuming telemetry, SMS/email notifications, and recommendation materializations.
*   **Database:** PostgreSQL 16 (Port 5432) backed by PgBouncer (Port 6432) multiplexing connections.

---

## 2. Incident Runbooks

### Alert: `Postgres Connection Exhaustion or Saturation`
*   **Symptom:** API logs show `too many clients already` or `/health/ready` returns 503 with database connection timeout errors.
*   **Diagnosis:**
    1.  Inspect active connections on PgBouncer:
        ```bash
        docker compose exec pgbouncer psql -U postgres -p 6432 -c "SHOW POOLS;"
        ```
    2.  Check active transactions in Postgres:
        ```bash
        docker compose exec postgres psql -U postgres -c "SELECT pid, age(clock_timestamp(), query_start), state, query FROM pg_stat_activity WHERE state != 'idle' ORDER BY age DESC LIMIT 10;"
        ```
*   **Mitigation Actions:**
    *   If a slow query is blocking connections (e.g. recommendation logic running on raw events table), kill the pid:
        ```sql
        SELECT pg_cancel_backend(PID);
        ```
    *   Scale PgBouncer pool limits in `docker-compose.production.yml` if traffic has legitimately scaled.
    *   Verify that client connection timeouts (5s) and slow query warnings (>250ms) are logging correctly in API containers.

### Alert: `Redis or BullMQ Queue Lag / Memory Exhaustion`
*   **Symptom:** `/health/deep` returns `degraded` for `telemetry_queue` or outbox events count is increasing.
*   **Diagnosis:**
    1.  Check Redis memory usage:
        ```bash
        docker compose exec redis redis-cli info memory
        ```
    2.  Check active/waiting BullMQ job counts:
        ```bash
        docker compose exec redis redis-cli hgetall bull:telemetry-dispatch:meta
        ```
*   **Mitigation Actions:**
    *   **Replay failed telemetry jobs:** If telemetry has accumulated in the `telemetry_dlq` database table due to downstream outages, trigger a telemetry replay:
        ```bash
        curl -X POST -H "Authorization: Bearer <ADMIN_TOKEN>" https://api.shopgoldplus.com/admin/telemetry/replay
        ```
    *   **Restart stuck workers:** If BullMQ jobs are stuck in the active state due to unhandled promise rejections, restart the worker container:
        ```bash
        docker compose restart api
        ```

### Alert: `Circuit Breakers Tripped (ZeptoMail / PesaPal / EgoSMS)`
*   **Symptom:** Logs show `[CircuitBreaker] Breaker is OPEN. Executing fallback` or `CircuitBreakerError`.
*   **Diagnosis:**
    *   Identify which circuit breaker is open in the logs (e.g., `pesapal` or `zeptomail`).
    *   Check external status page of the provider (PesaPal / EgoSMS / Zoho).
*   **Mitigation Actions:**
    *   **Degraded State Behaviors:**
        *   **ZeptoMail Open:** Confirm emails are stored safely in the database outbox table. They will automatically be re-attempted once the breaker cools down and transitions back to CLOSED.
        *   **PesaPal Open:** Warn customers on checkout that payment processing is undergoing maintenance; do not send corrupt/duplicate webhook notifications.
    *   Once the external provider resolves their issue, the breaker will automatically transition to `HALF_OPEN` and then `CLOSED` upon the next successful connection request.

---

## 3. Rollback & Deployment Procedures

### Zero-Downtime Rolling Update (Blue/Green)
To apply a safe release with health-gated preflight checks:
1.  Run tests locally and build images:
    ```bash
    pnpm run typecheck && pnpm test
    ```
2.  Perform rolling update deployment:
    ```bash
    docker compose -f docker-compose.production.yml up -d --build --remove-orphans
    ```
    *Note: The `deploy.update_config.order: start-first` directive ensures new containers are spun up and pass their `/health/ready` check before old ones are terminated.*

### Rapid Rollback Procedure
If post-deployment checkouts fail or error rate spikes:
1.  Rollback proxy configurations immediately:
    ```bash
    git checkout HEAD~1 -- docker-compose.production.yml Caddyfile
    docker compose -f docker-compose.production.yml up -d --build
    ```
2.  Verify status on `/health/ready` and ensure telemetry outbox resumes dispatching.
