# SRE Incident Playbooks

This document provides step-by-step resolution steps for common alerts triggered by the GoldPlus Commerce OS observability pipeline.

---

## Playbook 1: Spike in Database Deadlocks (`40P01`)
### Alert Criteria
`goldplus_db_deadlock_retries_total` increases by >5 in 1 minute.
### Mitigation Steps
1. **Identify Blocked Queries**: Run the active locks query to identify waiting queries.
   ```sql
   SELECT pid, query, state, wait_event_type, wait_event 
   FROM pg_stat_activity 
   WHERE wait_event_type = 'Lock';
   ```
2. **Terminate Blocking PID**: If a specific query is blocking others for >10 seconds, terminate it safely:
   ```sql
   SELECT pg_cancel_backend(blocking_pid);
   ```
3. **Optimize Indexing**: Verify that the queries use correct foreign key indexes.

---

## Playbook 2: Container Memory Pre-Warning (`OOM Pre-Warning`)
### Alert Criteria
`goldplus_container_oom_pre_warning == 1` (Memory usage exceeds 90% of limit).
### Mitigation Steps
1. **Locate Memory Leak**: Check the garbage collection duration histograms (`goldplus_container_gc_duration_seconds`).
2. **Force GC**: If running in a debugging environment, trigger a manual garbage collection.
3. **Scale Out**: If memory does not drop, scale out the API service:
   ```bash
   docker compose -f docker-compose.production.yml up -d --scale api=4
   ```

---

## Playbook 3: Outbound sGTM Signature Failures
### Alert Criteria
Logs show `[TelemetryDispatchService] Outbound dispatch payload verification failed`.
### Mitigation Steps
1. **Check Shared Key**: Confirm that the `GTM_SECRET` environment variable in the API container matches the key set in the sGTM container.
2. **Re-align Clock**: Verify system clock synchronization via NTP:
   ```bash
   chronyc tracking
   ```
   *Note: Skewed server times can break signature validations containing timestamps.*
