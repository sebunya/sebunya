# Production Rollback Plan

This plan documents the procedures to revert a failed release, database migration, or telemetry update to restore stable operations.

---

## 1. Trigger Conditions
Initiate a rollback if post-deployment checks or logs detect:
- Release health score dropping below 90.
- Database transaction deadlock rate exceeding 2%.
- Queue lag exceeding 30 seconds on critical queues (`telemetry-events`, `webhook-retries`).
- Core healthcheck endpoints returning `500` or failing readiness.

---

## 2. Step 1: Revert Code to Last Stable Version
Revert the container images to the previous tag:
```bash
# 1. Update tag in docker-compose.production.yml (e.g. from v1.2.0 to v1.1.9)
# 2. Deploy the stable container image
docker compose -f docker-compose.production.yml up -d --build
```

---

## 3. Step 2: Revert Database Migrations (If Needed)
If the release introduced incompatible schema changes, execute database rollbacks:
```bash
# Run migration rollback command (reverts the last migration step)
pnpm -F @goldplus/api db:rollback
```
*Note: Make sure to verify that rollback scripts are fully tested in staging prior to execution in production.*

---

## 4. Step 3: Cache and Queue Flush
To prevent replaying corrupted telemetry payloads or schema-incompatible cache entries:
1. **Clear Telemetry Replays**:
   ```bash
   redis-cli -u $REDIS_URL DEL bull:telemetry-replay:failed
   ```
2. **Flush CDN Cache**: Purge the CDN edge cache to prevent stale JavaScript telemetry trackers from executing on customer browsers.
