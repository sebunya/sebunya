# Codex End-to-End Execution Paths

Baseline: `bfb0ffc3d004f8eecc039722f540eef75d8d7193`. Paths describe current source behavior. They do not certify production execution.

## Checkout → order → inventory reservation → fulfilment

1. Entry: `POST /commerce/orders/create` in `goldplus-commerce/apps/api/src/interfaces/http/routes/commerce.ts`. Zod accepts customer/delivery data, buyer type, product IDs/quantities, and optional client order key; client prices, names, and SKUs are excluded.
2. `CheckoutUseCase.execute` in `application/use-cases/commerce/CheckoutUseCase.ts` bounds lines/quantities, resolves public catalogue rows through `IProductRepository`, calculates a configured delivery-zone fee through `IDeliveryZoneRepository`, constructs `Order`, and calls `IOrderRepository.save`.
3. `DrizzleOrderRepository.ts` persists `orders` and `order_items` in `schema/commerce.ts`; client-key uniqueness is the concurrent checkout idempotency point. The use case first returns a prior order for a known key.
4. The route invokes `ReserveInventoryForOrderUseCase`, which delegates to `DrizzleInventoryRepository.reserveForOrder`. A PostgreSQL transaction reads existing `inventory_reservations`, locks all product rows in sorted order, tests all lines, and either reserves every line or none. The protected invariant is `reserved_quantity <= stock_quantity` with no partial silent oversell.
5. The route invokes `CreateFulfilmentTaskOnOrderPlacedUseCase`. It maps every order line and truthful payment/delivery/stock warnings into `FulfilmentTask.openForOrder`; insufficient or unknown stock forces ON_HOLD. `DrizzleFulfilmentRepository.createForOrder` uses the unique fulfilment `order_id` constraint plus conflict handling so one order has one task.
6. Finally the route asks `EnqueueAdminOrderEmailUseCase` to persist an idempotent `ADMIN_ORDER_EMAIL` intent through `IOutboxRepository`; failure of reservation, fulfilment, or email is caught independently after the order has persisted and surfaced truthfully where applicable.

Persistence: `orders`, `order_items`, `products`, `inventory_reservations`, `fulfilment_tasks`, and `outbox_events`. Audit: checkout is customer-originated; later admin fulfilment mutations use their dedicated audit/event channels. Outbox boundary: no provider is called by checkout; only a durable dry-run intent is written.

Failure states: invalid body, unavailable product, missing price, DB unavailable, reservation failure → held stock-confirmation warning, fulfilment task creation failure logged after order, email enqueue failure logged after order. Idempotency: client order key, reservation rows per order/product, fulfilment task unique order ID, admin email key per order/event.

Tests/proofs: checkout and commerce unit/E2E tests under `goldplus-commerce/tests`; real race proof `apps/api/src/scripts/inventory-concurrency-proof.ts`; fulfilment creation and admin email units plus `admin-email-outbox-proof.ts`.

## Payment confirmation → order and fulfilment updates

1. Entries: provider webhook routes in `interfaces/http/routes/webhooks.ts`, PesaPal start/verify routes in commerce/account flows, and authorized administrative payment operations.
2. `RecordPaymentWebhookUseCase.ts` accepts only enabled providers/outcomes, positive integer UGX amounts, a required order, and a caller or provider-derived idempotency key. `StartPesaPalPaymentUseCase.ts` and `VerifyPesaPalPaymentUseCase.ts` keep initiation/redirect/verification distinct.
3. Ports `IPaymentRepository.ts`, `IPesaPalPaymentRepository.ts`, and `IPesaPalClient.ts` separate application policy from `DrizzlePaymentRepository.ts`, `DrizzlePaymentAttemptRepository.ts`, and the PesaPal adapter.
4. Payment persistence uses transactions and unique idempotency/provider keys. A successful provider result updates the payment/order payment state; repeated callbacks return the recorded payment rather than duplicating it.
5. `MarkFulfilmentPaymentConfirmedUseCase.ts` loads the existing task, applies payment status via `FulfilmentTask`, and does nothing when the same state is replayed. It never creates a second fulfilment task; creation belongs exclusively to OrderPlaced.
6. Payment notification intents route through the existing outbox/router. No redirect or queued payment alone is treated as paid, and delivery does not auto-complete payment.

Persistence: payment/payment-attempt tables in commerce/system schema, `orders.payment_status`, `fulfilment_tasks.payment_status`, relevant audit/outbox rows. Transactions are repository-owned. Admin confirmation is RBAC-protected by `payments.confirm` and audited; webhooks are system actors with verification/idempotency evidence.

Failure states: unknown provider, bad amount/outcome, missing order/idempotency, failed verification, provider timeout/unknown outcome, stale/missing fulfilment task. Idempotency: webhook key, provider reference, payment attempt keys, same-state fulfilment no-op.

Tests/proofs: payment state/idempotency/reconciliation unit tests and webhook route tests under `tests/unit`; payment measurement reconciliation proofs are separate from payment truth.

## Order event → administrator notification → outbox

1. Entries are order placed, payment confirmed, and order cancelled application events currently coordinated by commerce/fulfilment routes and use cases.
2. `EnqueueAdminOrderEmailUseCase.ts` derives preparation state from event/payment/stock, masks contact data, renders the operator message, and builds a stable `buildAdminEmailIdempotencyKey(orderId, event)`.
3. `IOutboxRepository.enqueueAdminOrderEmail` is implemented by `DrizzleOutboxRepository.ts`. It inserts one dry-run `outbox_events` row and uses `onConflictDoNothing` on the idempotency key.
4. `OutboxTicker.ts` invokes `ProcessOutboxBatchUseCase.ts`; `claimDueBatch` uses ordered `FOR UPDATE SKIP LOCKED`. `DefaultNotificationRouter` maps supported event types to configured recipients and existing email/WhatsApp/SMS adapters.
5. Each dispatch outcome is persisted through `RecordNotificationAttemptUseCase`; provider failures back off to a bounded retry count, missing mappings/configuration become terminal/unroutable, and successful events are marked processed. Replay rejects clean successful rows.

Persistence: `outbox_events`, notification attempt/audit tables. Outbox is the provider boundary. Routes and business use cases never synchronously call a provider. Configuration absence yields zero target calls; adapter status `DISABLED`/`NOT_CONFIGURED` is not `SENT`.

Failure/idempotency: unique event intent, skip-locked claiming, attempt counter and next-attempt time, maximum attempts, no replay of success. Tests/proofs: `ProcessOutboxBatchUseCase.test.ts`, notification router/provider tests, admin order email tests, and `apps/api/src/scripts/admin-email-outbox-proof.ts`.

## Customer DNA → Next Best Action

1. Entries: source signal ingestion/projection use cases and guarded admin recomputation/read routes in `interfaces/http/routes/admin/customer-dna.ts`.
2. `DrizzleCustomerSignalReader.ts` reads approved first-party order, payment, preference, and interaction signals with provenance/freshness. `ResolveCustomerIdentityUseCase` applies `CustomerIdentity.ts` rules and refuses weak or conflicting merges.
3. `ProjectCustomerProfileUseCase` computes feature and lifecycle snapshots through domain functions in `CustomerFeatures.ts` and `CustomerLifecycle.ts`, then persists through Customer DNA ports and `DrizzleCustomerDnaRepositories.ts`.
4. NBA evaluation in `NextBestAction.ts` deterministically evaluates candidates and may select `NO_ACTION`. Decision/candidate rows use stable decision/source/policy keys and conflict-safe inserts.
5. Admin reads require Customer DNA/NBA permissions; recomputation and identity review have separate permissions and audit evidence. Astro UI masks identifier keys and presents conflicts for operator review.

Persistence: `customer_profiles`, identity links/conflicts, feature/lifecycle snapshots, `nba_decisions`, and `nba_candidates` in `schema/customer_dna.ts` (migration `0037`). Transactions/uniqueness live in repositories; no provider/outbox boundary is crossed by NBA selection.

Failure states: no signal/no profile, low confidence, stale evidence, identity conflict, no eligible candidate, `NO_ACTION`. Idempotency: unique signal link, versioned snapshot keys, decision key. Tests/proofs: Customer DNA/NBA units and `apps/api/src/scripts/customer-dna-identity-proof.ts` against PostgreSQL.

## Decision Intelligence evaluation → insight workflow

1. Entry: `POST /admin/decision-intelligence/evaluate` in `routes/admin/decision-intelligence.ts`, protected by authentication and `decision_intelligence.evaluate`.
2. `EvaluateDecisionSignalsBatchUseCase` iterates versioned `DEFAULT_DECISION_POLICIES`, asks `IDecisionEvidenceReader` for real persisted evidence, and calls pure `evaluatePolicy(policy, evidence, now)`.
3. Evaluation truthfully returns missing dependency, no data, stale data, insufficient evidence, no action, or a scored insight. `buildInsightIdempotencyKey` scopes one active insight to category/signal/subject/window/policy.
4. `DrizzleDecisionEvidenceReader.ts` aggregates commerce/customer/inventory/fulfilment/search facts. `DrizzleDecisionInsightRepository.ts` persists `decision_insights`, `decision_evidence`, recommendations, assignments, and events; unique keys collapse repeat evaluation.
5. Read/transition/recompute routes use separate read/evaluate/assign/manage permissions. `TransitionDecisionInsightUseCase` enforces the domain transition map and expected version, persists its event/assignment, and calls `CreateAuditLogUseCase` through its dedicated audit channel.
6. The Astro list/detail pages show evidence, severity and confidence separately; 409 stale-version responses become explicit operator conflicts. A `DRAFT_RECOMMENDATION` can seed future Automation review but does not activate or execute anything.

Persistence: Decision Intelligence tables in `schema/decision_intelligence.ts` (migration `0038`) and governance audit. No provider/outbox effect exists in evaluation. Failure states and idempotency are explicit above. Tests/proofs: `DecisionIntelligence.test.ts`, Decision Intelligence use-case/route/UI tests, and `apps/api/src/scripts/decision-intelligence-proof.ts`.

## Automation trigger → execution planning (current A2 boundary)

1. Entry at this baseline is programmatic/proof-driven: `PlanAutomationExecutionUseCase.execute` accepts trigger family/ref/event ID, optional subject, window, and caller-supplied time. No Hono Automation route or Astro control room exists yet.
2. `IAutomationRepository.findActiveApprovedByTrigger` is implemented by `DrizzleAutomationRepository`. It reads the current version of ACTIVE definitions, matches trigger family/ref, and rejects lapsed/missing version-scoped approval when required.
3. `IAutomationAudienceReader.resolveSubject` is implemented by `DrizzleAutomationAudienceReader`, reading authoritative `customer_profiles`. Missing, conflicted, or stale profiles yield truthful non-eligible outcomes.
4. `evaluateConditions` in `domain/automation/Automation.ts` produces per-condition evidence. A2 supports lifecycle and consent categories; unknown categories fail closed.
5. The use case builds a trigger execution key, short-circuits an existing key, limits actions, builds per-action idempotency keys, and calls `IAutomationExecutionRepository.persistPlan`.
6. `DrizzleAutomationExecutionRepository` inserts one `automation_executions` row, its `automation_action_executions`, and a `PLANNED` automation event. Database unique keys collapse a concurrent planner race.

Persistence: `automation_definitions`, `automation_versions`, `automation_approvals`, `automation_executions`, `automation_action_executions`, and `automation_events` from migration `0039`. The repository currently performs separate inserts without an explicit encompassing transaction; A3 atomic effect/outbox work must address its own proven boundary without rewriting A2 broadly.

Audit: definition/admin lifecycle routes do not yet exist. Planning records an Automation event; later A4 mutations must use RBAC plus audit. Outbox/provider boundary: A2 writes no outbox row and calls no provider. `QUEUED`, `SENT`, retry, DLQ and replay are not implemented by A2.

Failure states: no matching definition, invalid/lapsed approval, action bound exceeded, no subject/profile, identity conflict, stale profile, failing condition, duplicate trigger. Idempotency: unique trigger key and unique action key. Tests/proofs: `AutomationA1Domain.test.ts`, `AutomationA2Planning.test.ts`, and real PostgreSQL `apps/api/src/scripts/automation-planning-proof.ts`.

## A3 impact path

A3 should extend the last path in this order: normalize the proven Automation JSONB boundary; add deterministic eligibility/suppression/frequency policy; claim planned actions restart-safely; persist internal effects or exactly one linked existing outbox intent atomically; let the existing outbox/router own any provider attempt; persist truthful outcomes/retry/DLQ/replay; expose guarded operator API/UI only in A4. Consent, Customer DNA, NBA, Decision Intelligence, fulfilment, inventory, Registry ordering, shared outbox, and provider adapters are dependencies or protected boundaries—not replacement targets.
