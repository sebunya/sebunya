# Cross-module dependency map
SHA `473ede0` · 2026-08-03. Arrows = runtime data/control flow. Sources: WORKER_EVENT_INDEX, ROUTE_CAPABILITY_INDEX, SCHEMA_OWNERSHIP_INDEX.

## Proven live flows (§33 targets already wired)
- Checkout → outbox side-effect events → fulfilment task (ORDER_FULFILMENT_REQUIRED), admin+customer notifications (ORDER_ADMIN_NOTIFICATION_REQUIRED / ORDER_CUSTOMER_NOTIFICATION_ELIGIBLE), payment initiation/verification, loyalty eligibility (ORDER_LOYALTY_ELIGIBILITY_RECORDED), measurement eligibility (ORDER_MEASUREMENT_ELIGIBILITY_RECORDED). Partitioned processors: ProcessOutboxBatch (general) / ProcessCheckoutSideEffectBatch (side-effects) / TelemetryDispatchService (TELEMETRY_DISPATCH).
- Payments → email-jobs queue (DrizzlePaymentRepository enqueues) → notifications.
- Measurement events → outbox → telemetry-dispatch worker → sGTM → telemetry_dlq on failure (5 attempts, 30s→6h backoff) → admin DLQ replay (measurement use-cases; same-origin BFF proxy).
- Recommendations → hourly materializer cron (analytics-fanout repeat) → placement reads on storefront; recommendation-processing queue consumes events.
- Cart identity → checkout intent (both minted by web BFF, verified by API middlewares, dedicated secret streams from one derivation family).
- Permission registry (code) → boot sync → roles/role_permissions → auth middleware grant list → 271 guarded routes + step-up MFA (pricing approval).
- Synthetic read journey → storefront + catalogue parity + PDP + recommendations (health signal, prometheus gauges).

## Declared but NOT yet flowing (do not claim in UI)
- abandoned-cart-events queue: no producer/worker → §11 abandonment → campaigns pipeline is NOT live.
- campaigns/utm_links tables: no reader/writer → campaign attribution flows not live.
- telemetry-replay + inventory-sync queues: declared, unwired.
- Loyalty refund-reversal (§32) and fraud→fulfilment hold (§33): not yet proven end-to-end — schedule with their phases.

## Rule
A module may only claim a cross-module capability when the arrow above exists in code AND an evidence row (test or live proof) backs it. Update this map in the same commit that wires a new arrow.
