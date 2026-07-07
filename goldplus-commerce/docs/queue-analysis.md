# Distributed Queue Hardening and Analysis Report

This document details the telemetry metrics, backpressure automation, failure recovery routes, and operations parameters implemented for BullMQ queues in GoldPlus Commerce OS.

---

## 1. Queue Architecture
GoldPlus Commerce OS runs an asynchronous outbox pattern and telemetry pipeline powered by BullMQ and Redis:
- **`telemetry-events`**: Telemetry and conversion tracking ingestion.
- **`telemetry-replay`**: Failed conversion/tracking replay buffer.
- **`webhook-retries`**: Outbound payment/fulfillment webhook retry pipeline.
- **`recommendation-processing`**: Item scoring and vector index calculation.
- **`inventory-sync`**: Catalog inventory updates.
- **`email-jobs` / `sms-jobs`**: Notification delivery.

---

## 2. Job Lifecycle Telemetry
To measure queue performance, we register and track histograms on the worker hooks:
- **Lag Metric (`goldplus_queue_job_lag_seconds`)**: Measures how long a job waits in the `waiting` state before a worker processes it (`processing_start_time - job_creation_time`). High lag indicates resource starvation or insufficient concurrency.
- **Duration Metric (`goldplus_queue_job_processing_duration_seconds`)**: Measures execution duration of the job (`processing_end_time - processing_start_time`).
- **Failure Classification**: Tracks and counts job exceptions by error code (e.g. `NETWORK_ERROR`, `TIMEOUT`, `REDIS_UNAVAILABLE`).

---

## 3. Adaptive Backpressure Regulation
To prevent database exhaustion during heavy load spikes:
- **State Check**: Every 5 seconds, an internal monitor reads the database slow query log buffer and the event loop lag.
- **Throttling Formula**:
  - If `avgDbLatency > 200ms` OR `eventLoopLag > 100ms`, concurrency is decreased by `1` (down to a minimum of `1`).
  - If `avgDbLatency < 50ms` AND `eventLoopLag < 20ms`, concurrency is increased by `1` (up to the maximum configured concurrency).
- **Throttling Benefit**: Protects PostgreSQL and Redis from cascading failures due to connection exhaustion or high CPU usage.

---

## 4. Disaster Recovery & Manual Replays
If downstream tracking servers (e.g. Meta, TikTok, sGTM) suffer outages, failed jobs are routed to the dead-letter queue (failed jobs set):
- **Admin Replay Endpoint**: `POST /admin/queues/replay` allows SREs to programmatically shift failed jobs back to the active queue for reprocessing.
- **Example Payload**:
  ```json
  {
    "queueName": "telemetry-events"
  }
  ```
- **Manual Concurrency Override**: `POST /admin/queues/concurrency` allows manually overriding a worker's concurrency without requiring a service redeployment.
  ```json
  {
    "queueName": "telemetry-events",
    "concurrency": 15
  }
  ```
