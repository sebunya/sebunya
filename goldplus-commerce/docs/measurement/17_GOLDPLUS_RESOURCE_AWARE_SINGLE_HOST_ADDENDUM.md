# GoldPlus — resource-aware single-host implementation addendum

## Direct instruction to Claude Code

Apply this addendum to the existing GoldPlus implementation dossier. The user prefers to use the current reported 3 GB RAM / 2-vCPU Hetzner shop server and expects up to 30,000 users per month. Those hardware values are reported, not yet independently confirmed here. Inspect actual capacity and usage in your environment.

This addendum overrides the earlier blanket requirement for a separate production analytics host. **Do not mark analytics implementation blocked solely because no second server exists.** Build and evaluate a resource-aware single-host profile first, while keeping the full architecture deployable later. Equally, do not claim every service fits without measurements or reduce reliability controls to force a successful status.

The desired architecture is continuous durable collection and essential operational processing, combined with scheduled analytical computation. Components may be installed/implemented without remaining resident. A paused/uninstalled deployment component is not a completed running capability; retain explicit runtime status. If a heavyweight component cannot fit even when scheduled, report that individual runtime limitation and continue other work.

Do not deploy changes recklessly on production. First inspect and prepare the implementation, verify limits and rollback, then use existing authorization for a bounded canary. This instruction does not authorize wiping queues, disabling payment processing, killing PostgreSQL or executing production stress tests.

## 1. Correct the capacity argument

Thirty thousand monthly users does not imply high continuous analytical load. It also does not specify concurrency, sessions, events, bot traffic, database size, merge overhead or model memory. Estimate those separately.

Illustration only: 30,000 users × 2 sessions × 15 events = 900,000 events/month, about 0.35 events/second averaged over a 30-day month. This says nothing about campaign bursts. Replace these assumptions with observed sessions/events/peak requests, row sizes and retention.

Inventory all resident processes, including web/API, PostgreSQL, Redis, workers, reverse proxy, monitoring, builds and any local sGTM/PostHog components. Do not budget just the named analytics containers. Determine actual total memory, CPU quota, available disk, filesystem and swap; distinguish host RAM from a container limit or a single observed free-memory number.

ClickHouse documents small-memory operation down to 2 GB with additional tuning and low ingest rates. This establishes that a low-memory experiment is reasonable, not that ClickHouse plus the entire shop and orchestration stack fits in 3 GB. [Official small-memory guidance](https://clickhouse.com/docs/guides/oss/best-practices/tips).

## 2. Three deployment profiles

### commerce-core — continuously available

Keep the current shop, PostgreSQL, Redis and essential payment/order processing running. Reuse existing Node workers where sound; do not create one always-running Node process for every dormant provider. Preserve transactional business events, durable delivery intent, consent/withdrawal, dispatch gates, retry and essential audit.

Provider conversion delivery remains prompt within the supported event-age windows. It must not wait for a nightly ClickHouse run. Current destination state, attempts, DLQ and kill switches remain available from PostgreSQL even while analytics is offline.

Collect approved browser events durably using a bounded existing queue/spool or a deliberately designed small ingress store. Acknowledge only after durability. Use batch writes, retention/disk limits and backpressure. Do not put unbounded behavioral traffic in a hot commerce transaction table without benchmarking it, and never drop authoritative payment/order/refund events to save RAM. Do not disable consent or PII controls.

### analytics-batch — one bounded job sequence at a time

Use a systemd timer or existing lightweight scheduler as the outer trigger. Persist job/run history and checkpoints. A single host-wide analytics lease/lock prevents overlap among ingestion, dbt, attribution, backup-heavy activity, compaction and training. A process-local mutex does not prevent another container from starting work.

Sequence work rather than start the full stack:

1. Check resource/commerce health and acquire the lock.
2. Extract a bounded media/state batch to durable staging; persist its manifest and checkpoint; release the extraction process.
3. Start ClickHouse if the chosen profile stops it between runs; wait for readiness with timeout.
4. Ingest staged batches and authoritative event exports idempotently. Use small bounded chunks and monitor part count/merge backlog.
5. Run only the due bounded transformations and reconciliation queries, serially.
6. Publish small dashboard result snapshots and source watermarks to the existing protected application serving layer.
7. Finish or safely checkpoint pending export work. Gracefully stop ClickHouse if scheduled-stop mode is enabled; preserve its data volume.
8. Record results, release the lock and exit.

The ClickHouse client/transform process and server coexist while executing a query. Budget their combined peak, including native memory, decompression, background tasks and OS overhead. Staging extraction separately saves overlap but cannot remove intrinsic query working-set requirements.

A small continuously running tuned ClickHouse instance is an alternative **only if its measured headroom is better than repeated startup/catch-up behavior**. Benchmark both; do not assume turning it off always improves performance. Cold starts and deferred merges can create spikes. Never disable all merging indefinitely: small-part accumulation eventually breaks ingestion.

### analytics-full — preserved for capacity that supports it

Retain full PeerDB, resident Dagster services, ClickStack and production science-runner deployment definitions as optional profiles. Do not enable all of them by default on this host. Their implementation, contract tests and migrations can proceed while their resident deployment remains off.

## 3. Treatment of each component

| Component | Initial resource-aware approach | What must remain explicit |
| --- | --- | --- |
| ClickHouse | Test bounded batch mode versus tuned resident mode | Runtime feasibility and query/merge limits must be measured |
| PeerDB | Implement/configure optional profile; assess complete dependency footprint before enabling | A simple scheduled state exporter is an alternative transport, not PeerDB CDC |
| Dagster | Keep asset/job definitions; evaluate supported direct/in-process bounded execution launched by outer timer | No daemon means Dagster-native schedules/sensors/queued coordinator do not operate automatically |
| dlt | One account/report extraction at a time, exit after durable checkpoint | Pagination, revisions, secrets and load state remain correct |
| dbt | Selected models, one thread, bounded affected partitions | Avoid full-history rebuilds and wide joins each cycle |
| Attribution | Small incremental rule-based runs; heavier Markov/Shapley less often with bounded state size | Observational labels, coverage and deterministic results preserved |
| MMM/PyMC/Meridian/Robyn | Implement runners; profile each individual training workload; no parallel chains/engines by default | One job can still exceed host RAM; smaller concurrency is not proof it fits |
| CLV/optimizer | Batch on approved snapshots, bounded models/solver budgets | Full constraints/uncertainty remain required |
| ClickStack | Keep integration ready; use existing lightweight logs/metrics initially | Not deployed does not equal deployed/healthy |
| Control Tower | Current operational state from PostgreSQL; analytical panels use published snapshots | Show computed_at, source_watermark, freshness and unavailable states |

Dagster's documented Docker deployment has multiple long-running services, so do not blindly deploy its full Compose example here. Use supported execution APIs with durable run storage and verify the selected version; do not accidentally submit a queued run that needs a daemon you stopped. [Dagster deployment](https://docs.dagster.io/deployment/oss/deployment-options/docker), [execution API](https://docs.dagster.io/api/dagster/execution).

PeerDB's documented quickstart includes service dependencies such as its catalog and Temporal. Budget the real selected version's entire deployment. Pausing logical replication can retain PostgreSQL WAL; never leave a paused slot unmonitored. [PeerDB quickstart](https://docs.peerdb.io/quickstart/quickstart), [PostgreSQL logical decoding](https://www.postgresql.org/docs/current/logicaldecoding-explanation.html).

## 4. Lightweight state replication alternative

For the initial single-host mode, evaluate the following documented resource-driven alternative to always-on PeerDB, retaining PeerDB integration as an optional profile. Report this transport substitution explicitly in the implementation decision and deployment summary; do not claim PeerDB is running when it is not. Preserve the distinction between state replication and immutable financial events.

Preferred low-overhead pattern:

- Authoritative order/payment/refund movement already comes from transactional events and the outbox.
- For current dimensions/state, emit a transactional change marker when approved source records change, including explicit deletion tombstones. Reuse a proven change feed if it exists.
- A bounded scheduled exporter consumes markers with durable acknowledgements, exports safe typed state and versions, and handles deletes.
- Seed the initial state in bounded primary-key chunks with a tested handoff to ongoing markers.
- Reconcile row counts/keys/checksums in bounded intervals.

Do not use `id > last_max_id` on a commit-racing sequence as the sole correctness mechanism. Do not use naive `updated_at > last_timestamp` polling that can miss equal timestamps, late commits, deletes or changes that bypass that field. If timestamp polling is temporarily used, document its limitations and supply tested overlap, stable tie-breakers, deletion capture and reconciliation. It is not equivalent to complete WAL CDC by declaration.

No raw customer PII or secrets in analytical state exports. Preserve source version ordering, latest-row/delete semantics, idempotency and safe backfills. Label the transport `SCHEDULED_STATE_EXPORT`, not `PEERDB_ACTIVE`.

## 5. Measured resource budget

Build a table of observed peak memory and CPU/IO for:

- OS and all baseline resident services;
- commerce during representative peak activity;
- export/extraction process alone;
- ClickHouse startup/idle/ingest/merge/query;
- ClickHouse plus the selected client/dbt process;
- each scientific job independently;
- backup/build overlap if it can occur.

Use actual bytes/MiB consistently and avoid double-counting shared memory or excluding page-cache pressure. Container summaries alone can omit important host effects.

Budget rule:

`allowed analytics working set = actual host memory − measured protected commerce+OS budget − explicit safety reserve`.

Select a reserve from observed burst behavior; a proposed initial floor of several hundred MiB is only a hypothesis to test, not a promise. If the analytics task needs more than this allowance, do not shrink the shop's working set until it starts swapping or failing. Reduce analytical workload/batch size, choose a lighter execution path or report that task as needing more capacity.

Enforce an **aggregate** analytics cgroup/container memory and CPU budget, not independent per-container caps whose sum oversubscribes RAM. Verify the deployed cgroup/Compose/systemd enforcement. Use CPU quotas/weights and appropriate IO controls where supported. `nice` alone is not memory isolation. Database query limits do not cover every native allocation; retain process-level limits and headroom.

Use one query thread where appropriate, restrained block sizes, bounded joins, selective columns, reduced nonessential cache/log overhead and bounded read ranges. Validate all setting names and combinations against the pinned ClickHouse version. Do not apply random tiny cache/background-pool values merely to get startup past a check. Keep essential audit and operational telemetry even if high-volume internal logs are reduced.

Swap may provide emergency tolerance if reviewed, but does not count as usable capacity for this plan. Sustained swapping, OOM kills or deteriorating checkout latency fails acceptance. Do not disable OOM protections or overcommit the host to win a benchmark.

## 6. Adaptive admission and safe interruption

A scheduled time is only an opportunity to run. Before admitting work, check commerce latency/error baseline, memory availability/pressure, CPU/IO pressure, disk free, pending critical work and lease ownership. Quiet hours must come from observation; orders can arrive at night.

State machine:

`DUE → CHECKING → RUNNING → PUBLISHING → COMPLETE`, with `DEFERRED_RESOURCE`, `CHECKPOINTED`, `FAILED` and `CANCELLED` outcomes.

When load rises, stop admitting additional analytical tasks, cancel bounded analytical queries or checkpoint jobs safely, and gracefully stop analytics-only processes if necessary. Do not terminate commerce processes. Preserve input/checkpoint/run manifests so retry is idempotent. Set a maximum deferral age and alert if analytics continually starves; “always deferred” is not a functioning pipeline.

Ensure task timeout, host-wide locking, stale-lease recovery and clean shutdown. Avoid automatic restart policies that immediately restart a deliberately stopped batch service. Do not expose Docker socket access to the web application merely to let a dashboard turn containers on.

## 7. Proposed scheduling and dashboard semantics

Initial scheduling hypotheses, to adjust after measurement:

| Work | Initial cadence/trigger |
| --- | --- |
| Payments/orders/consent and essential provider dispatch | Continuous, prompt and bounded |
| Durable behavioral capture | Continuous, batched writes |
| Analytical export and compact mart refresh | Every 30–60 minutes when admitted, or wider window if resources require |
| Media reports | Daily with provider-specific restatement; avoid unnecessary frequent full-history pulls |
| Rule attribution/cohort updates | Daily over changed/matured ranges |
| Markov/Shapley | Weekly or on material data change; bounded dimensions |
| MMM/CLV fitting | On sufficient new data and model policy, after profiling; no automatic daily refit |
| Budget scenarios | On approved model changes or explicit requests, subject to admission |

Scheduling here trades analytical freshness for resource use. Dashboard analytical panels must serve the latest complete published snapshot, show its timestamp and source watermark, and avoid synchronous wake-up/full scan per page load. If no snapshot exists, show unavailable. Operational destination status and replay controls stay live from their operational source.

A full model training run may need a temporary larger machine or an existing authorized development machine even when daily reporting fits. This is a per-workload conclusion, not an automatic requirement for a permanently separate analytics server. Do not move client data or credentials to an external machine without authorized access/storage controls.

## 8. Verification before a verdict

Implement the profiles, scheduler/admission logic, export/checkpoint flow and cached analytical serving path. Produce a repeatable benchmark harness. Test representative peak commerce plus each admitted analytics workload in an isolated comparable environment first. Then use a bounded production canary only under existing authorization; do not generate synthetic charges or real ad conversions.

Required observations:

1. Shop/payment latency and error rates compared with baseline, including p95/p99 where sample supports it.
2. Peak combined RAM, pressure, OOM events, swap activity, CPU and IO.
3. Largest expected query/backfill chunk and ClickHouse merge backlog.
4. Successful job completion within freshness target, not merely successful startup.
5. Analytics cancellation/deferral while orders remain healthy.
6. Recovery after worker restart and analytical downtime with no lost events or duplicate financial effects.
7. Disk/WAL/spool growth and bounded retention/backpressure.
8. Each scientific job's own working set and successful diagnostic completion.

Do not set universal latency thresholds without a baseline. Zero new OOM events, zero lost authoritative events and zero duplicate business effects are hard invariants. Establish explicit acceptable latency/freshness budgets before canary activation.

Return a component-by-component verdict: `FITS_MEASURED`, `FITS_WITH_SCHEDULED_MODE`, `NOT_YET_BENCHMARKED`, `EXCEEDS_AVAILABLE_BUDGET` or `EXTERNAL_DEPENDENCY`. Show evidence and exact next action. Do not simply repeat “3 GB means blocked,” and do not state “30,000 users means it fits.”

## Final instruction

Proceed with a **measured, scheduled, resource-aware single-host implementation**. Preserve the complete functional roadmap and all correctness/privacy guarantees. Relax the earlier compulsory separate-host rule, not the protection of the live shop. The goal is to make the most useful safe deployment fit the existing resources, prove it, and identify any remaining constraint precisely.
