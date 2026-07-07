# Disaster Recovery Plan

This plan documents recovery procedures for catastrophic events, including loss of the primary database, Redis cluster crashes, or external server-side GTM outages.

---

## 1. Primary Database Failover
If the primary PostgreSQL server suffers a hardware failure:
1. **Promote Read Replica**: Execute failover on Hetzner Cloud to promote the read replica to primary.
   ```bash
   pg_ctl promote -D /var/lib/postgresql/data
   ```
2. **Update Connection String**: Point PgBouncer to the new primary database address.
3. **Verify Poolers**: Restart PgBouncer connections:
   ```bash
   pgbouncer -d -R /etc/pgbouncer/pgbouncer.ini
   ```

---

## 2. Redis Cache Eviction & Recovery
If the Redis instance runs out of memory or crashes:
1. **Eviction Policy**: Ensure `maxmemory-policy` is set to `volatile-lru` or `allkeys-lru` in `redis.conf` so Redis evicts expired keys automatically.
2. **Persistent Queue Storage**: BullMQ uses Redis key structures. Ensure Redis append-only files (AOF) are enabled with `appendfsync everysec` to prevent losing background queue jobs.
3. **Re-Initialize Workers**: If Redis is entirely wiped, re-initialize the API instances. BullMQ will recreate the empty queues automatically, and cron schedules will resume.

---

## 3. Downstream tracking & sGTM Failure
If the server-side GTM endpoint experiences an outage:
1. **Automatic Outbox Queueing**: The outbox runner detects dispatch failures and retries payloads with exponential backoff.
2. **Increase Telemetry Queue TTL**: Prevent BullMQ from evicting failed telemetry events. Set retention to 7 days:
   ```typescript
   // In job configuration
   removeOnFail: { age: 7 * 24 * 3600 }
   ```
3. **Internal Allowlist Verification**: If sGTM IP addresses rotate, update the SSRF allowlist to permit dispatch to the new IP range.
