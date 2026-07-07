# Observability and Telemetry Architecture Report

This document details the telemetry instrumentation and infrastructure observability configuration implemented for GoldPlus Commerce OS to monitor runtime systems, container lifecycles, and database interactions in real-time.

---

## 1. Container cgroup & Performance Metrics
To track hardware limits, memory consumption, and runtime anomalies under container virtualization (Kubernetes / Hetzner Docker deployments), a dedicated `ContainerMetricsCollector.ts` runs on a loop to report metrics directly into the `/metrics` endpoint:
- **Memory Limit and Usage**: Resolves limits dynamically from cgroups (`memory.max` in v2 / `memory.limit_in_bytes` in v1), falling back to V8 heap statistics on non-Linux architectures.
- **OOM Pre-Warning Indicator**: A gauge (`goldplus_container_oom_pre_warning`) is set to `1` if cgroup memory consumption exceeds 90% of the allocated container memory limit, triggering early pod warning alerts.
- **CPU Throttling**: Parses `cpu.stat` values to report the cumulative CPU throttle duration (`goldplus_container_cpu_throttled_seconds`).
- **File Descriptors**: Scans `/proc/self/fd` to measure file handle leakage (`goldplus_container_open_file_descriptors`).

---

## 2. V8 Runtime Metrics
- **Garbage Collection (GC) Tracking**: Uses Node.js's native `PerformanceObserver` to record the execution duration of each GC pass. Differentiates between `scavenge`, `mark-sweep`, and `other` passes, publishing these values as a Prometheus histogram (`goldplus_container_gc_duration_seconds`).
- **Event Loop Utilization (ELU)**: Continuously sample-tracks Node's Event Loop Utilization ratio (`goldplus_container_event_loop_utilization_ratio`) using Node's native `performance.eventLoopUtilization()` to gauge CPU thread saturation.

---

## 3. Database Metrics & Connection Auditing
- **Connection Pools**: Tracks active connections (`goldplus_db_connections_active`), maximum connection capacities (`goldplus_db_connections_max`), and connection pool utilization.
- **Catalog Metrics**: Safely queries PG stats catalogs to track waiting lock contentions, prepared statements counts, active physical standbys, and WAL (write-ahead log) LSN differential sizes.
- **Slow Query Detection**: Hooks into database client executions. Any query exceeding a 250ms threshold writes warnings to the structured Logger and updates the rolling slow query counter.

---

## 4. End-to-End Trace Context Propagation
To trace requests across distributed bounds:
- **Tracing Context**: Request IDs (Correlation IDs) are generated at the API Gateway or HTTP middleware level.
- **Local Storage Tracing**: Leverages `AsyncLocalStorage` (`TraceContext.ts`) to make the correlation ID and authenticated user ID accessible to all deep service calls without passing them as function parameters.
- **Queue Propagation**: BullMQ jobs automatically inherit the current request context's Correlation ID inside their payloads. Workers extract this ID on job start and bind it to the local worker execution context.
- **Outbox Telemetry**: Outbox events and structured log entries write the propagated correlation ID to allow SREs to trace a storefront action to its asynchronous background outbox delivery.
