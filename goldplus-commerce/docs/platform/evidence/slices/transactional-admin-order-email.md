# Transactional administrator order email — evidence

Reuses the existing transactional outbox (`outbox_events`), `ProcessOutboxBatchUseCase`
(retry/backoff/exhaust→dead-letter), `DefaultNotificationRouter`, and the ZeptoMail adapter.
No second notification/outbox system was created. No new migration (schema unchanged).

## Design

- **One idempotent intent per order event** via the unique `outbox_events.idempotency_key`
  with `onConflictDoNothing`. Keys exactly: `order:{id}:admin-email:placed`,
  `…:payment-confirmed`, `…:cancelled`. Enqueued on OrderPlaced (checkout), PaymentConfirmed
  (PesaPal callback + IPN completed branches), and OrderCancelled (fulfilment CANCELLED).
- **Truthful preparation state** (`deriveAdminPreparationState`): `READY_FOR_PREPARATION` only
  when payment **and** stock are confirmed; else `AWAITING_PAYMENT`, `ON_HOLD_STOCK`, or
  `CANCELLED`. **Payment confirmation never clears an inventory hold** — stockConfirmed is
  derived from the fulfilment task's ON_HOLD state, not from payment.
- **Secure recipients** from `ADMIN_ORDER_NOTIFICATION_EMAILS` ‖ `OPS_ALERT_EMAIL`
  (never hard-coded); parsed/validated/deduped; `MISSING_CONFIG` when empty; masked for display.
- **One email per order** (not per product) with plain-text + HTML bodies, all products, SKUs,
  quantities, unit/line totals, truthful payment/stock/fulfilment states, masked contact,
  delivery summary, and a secure `ADMIN_ORDER_LINK_BASE_URL` admin link. All user input escaped.
- **No-send safety**: enqueue sets `dryRunOnly: true`; the ZeptoMail adapter returns `DISABLED`
  (zero network) unless `NOTIFICATIONS_EMAIL_ENABLED`/`NOTIFICATIONS_LIVE_SEND_ENABLED` are on.
  `SENT` only follows real provider success. The order/fulfilment/notification remain available
  even when the provider fails (enqueue is best-effort and never fails the order).
- **Retry / DLQ / manual replay**: `ProcessOutboxBatchUseCase` retries with capped exponential
  backoff and dead-letters after 8 attempts. `ReplayAdminOrderEmailUseCase` requeues a
  failed/dead-letter intent (RBAC `orders.manage`, audited `ADMIN_ORDER_EMAIL_REPLAYED`); a
  cleanly-SENT intent (last_error IS NULL) is never re-sent. Admin surface:
  `GET /admin/notifications/admin-order-emails` + `POST …/:id/replay`, and the
  `/admin/notifications/order-emails` page (recipient readiness, delivery state, replay).

## Proofs

- **Real PostgreSQL** (`src/scripts/admin-email-outbox-proof.ts`):
  `{"sequentialRows":1,"concurrentRows":1,"failedReplayed":true,"statusAfterReplay":"pending","sentEventReplayable":false,"verdict":"PASS"}`
  — unique key dedupes sequential + concurrent duplicate enqueues to a single row; failed/
  dead-letter is replayable; a delivered event is never re-sent.
- **Unit** (`tests/unit/AdminOrderEmail.test.ts`, 12): idempotency keys, preparation-state rules
  (incl. payment-not-clearing-hold), recipient parse/dedupe/mask/MISSING_CONFIG, all-products
  rendering, correct totals, HTML escaping (no XSS), do-not-prepare warning.
- Architecture 10/10 (enqueue routes through the outbox port — no infra import in the
  application layer; replay route audit-exempt via its use case).

## Layer status

`SOURCE_COMPLETE_NOT_DEPLOYED` — provider send stays gated (no-send) and no `ssh goldplus-prod`
here, so not LIVE_VERIFIED.
