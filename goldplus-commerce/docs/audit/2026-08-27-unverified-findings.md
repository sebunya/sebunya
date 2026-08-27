# Codebase audit, 2026-08-27: findings awaiting verification
A whole-repo bug sweep was run as 23 parallel subsystem audits, each followed by
an adversarial refuter and a reproducer. **The run stopped early on a model quota
limit: 6 of the 23 finder slices completed, and NONE of the verification stage ran.**
So everything below is a **first-pass claim from a single reader**. Three have since
been verified and fixed by hand (marked FIXED). The rest are *unverified*: expect a
meaningful share to be wrong, already guarded elsewhere, or intended. Verify before acting.

## What was and was not covered
Covered: checkout/commerce, payments/outbox, identity/security, pricing/products/inventory,
delivery/fulfilment/locations, batteries.

Not covered (never ran): loyalty/consent/notifications, public HTTP routes, admin HTTP routes,
the 125 Drizzle repositories, SEO growth, recommendations/hero/nav, analytics/measurement,
platform/config/scheduler, the storefront funnel and discovery pages, all 123 admin pages,
packages/shared, the recent-commit diff review, and the whole-repo bad-pattern sweep.

**74 findings: 2 critical, 20 high, 28 medium, 24 low.**

---

## Critical (2)

### A declined or abandoned payment can never be retried: the deterministic merchant reference reuses the terminal attempt and the pending write is an illegal transition **[FIXED 2026-08-27]**
`apps/api/src/application/use-cases/payments/StartPesaPalPaymentUseCase.ts:54` | correctness | finder confidence 0.85

**Reachable via:** POST /commerce/payments/pesapal/start (storefront checkoutClient.ts:165, the 'Try payment again' CTA on /checkout/pesapal/callback?status=failed, and the order page pay button)

**Scenario:** Customer starts PesaPal payment on order GP-202608-ABCD; attempt GP-GP-202608-ABCD-<id8> is created and the provider later reports FAILED (wrong PIN, insufficient balance) or INVALID (page abandoned). The attempt is now terminal ('failed'/'invalid'). The failed page says 'Try payment again' and links to /checkout; the order page's new pay-for-unpaid-order button does the same. StartOrderPaymentUseCase finds no reusable attempt (only pending/verification_pending count) and calls this use case. findByMerchantReference returns the SAME terminal attempt (the reference is deterministic and the column is UNIQUE), submitOrderRequest creates a NEW live provider transaction, then updatePaymentAttemptStatus(attempt.id, { status: 'pending' }) calls assertAttemptTransition('failed','pending') which throws PAYMENT_STATE_ILLEGAL_TRANSITION. StartOrderPaymentUseCase maps that to PROVIDER_UNAVAILABLE and the customer sees 'Payment could not be started for this order.' (HTTP 502) forever. The new tracking id is never stored, so if the provider transaction is ever paid it matches nothing. Every one of the 8 real attempts recorded in docs/payments/DECISIONS.md (3 Failed, 5 INVALID) is in exactly this state.

**Why it is wrong:** StartOrderPaymentUseCase's contract (its own comment, line 113-116, and StartOrderPaymentUseCase.test.ts 'starts a fresh attempt when the previous one failed') is that a terminal attempt gets a FRESH attempt. This use case cannot create one because the merchant reference is derived only from the order, so it resurrects a terminal row through the single write path that (correctly) refuses resurrection. The unit test passes only because the provider is mocked; PesapalPaymentJourney seeds attempts directly and never runs a second real start. Core journey broken: a customer whose first mobile-money charge failed (the most common outcome in Ugandan mobile money) cannot pay for the order.

**Proposed fix:** In StartPesaPalPaymentUseCase, when findByMerchantReference returns an attempt whose status is in TERMINAL_ATTEMPT_STATUSES (or 'verification_failed'), create a NEW attempt with a fresh reference (e.g. append an attempt ordinal or the first 8 chars of a new UUID: `GP-${orderNumber}-${shortId}-${n}` kept under 50 chars) and only reuse an existing row when it is not_started/pending/verification_pending. Keep the illegal-transition guard as is. Add to tests/integration/PesapalPaymentJourney.integration.test.ts: 'a FAILED attempt can be followed by a second real start that creates a new attempt and settles COMPLETED', and a unit test in tests/unit/pesapal-payment.test.ts asserting createPaymentAttempt is called with a distinct merchantReference when the existing one is terminal.

### Any signed-in customer can read any order in full (PII) by id or by 16-bit order number **[FIXED 2026-08-27]**
`apps/api/src/interfaces/http/routes/commerce.ts:884` | authorization | finder confidence 0.92

**Reachable via:** GET /commerce/orders/:id with any customer session

**Scenario:** Register a free customer account, then GET /commerce/orders/GP-202608-0000 … GP-202608-FFFF with the session bearer token. DrizzleOrderRepository.findById (line 28-31) resolves a non-UUID param as order_number, and order numbers are GP-YYYYMM-<first 4 hex of uuid> (Order.ts:133), i.e. 65,536 values per month. Each hit returns the whole Order domain object: customerName, customerPhone, customerEmail, deliveryAddress, deliveryLocation (GPS lat/lng, parish, postcode), items, userId, loyaltyRedemptionId, pricing snapshot. The handler never compares order.userId to c.get('userId'), and nothing in the storefront calls this route (grep of apps/web for 'commerce/orders/' finds only create/lookup), so it is a live, unused, enumerable PII endpoint.

**Why it is wrong:** Object-level authorization is missing on a customer-facing read: 'requires a session' is not 'belongs to this customer'. docs/passes/account-order-trust-h1d.md records that this exact route leaked full orders to unauthenticated callers and was 'hard-prevented'; the fix only added customerSessionMiddleware, and tests/unit/OrderTracking.test.ts:401 pins only the unauthenticated case with a simulation, not the cross-customer case. The repo rule 'do not retain unnecessary PII' and the account route's own pattern (GET /account/orders/:id uses findByIdForUser scoped by userId) show the intended boundary.

**Proposed fix:** Delete the route (nothing calls it), or make it thin over a use case that enforces ownership: for a USER session call GetMyOrderUseCase.execute(id, userId) (which uses findByIdForUser with eq(orders.userId, userId)), and refuse order-number lookups entirely (the public order-number path is POST /orders/lookup, which requires the matching contact). Never spread the domain Order into the response; return OrderDetailDto. Pin with a route test 'GET /commerce/orders/:id returns 404 for an order owned by another user and for an order number' (tests/unit/OrderTracking.test.ts should exercise the real handler instead of simulateDirectGet).

---

## High (20)

### Archiving a battery does not release its aliases: the partial unique index still blocks re-creating the same code (raw 500 / every re-import row FAILED)
`apps/api/src/application/use-cases/batteries/BatteryCatalogueUseCases.ts:345` | data-integrity | finder confidence 0.85

**Reachable via:** POST /admin/batteries/imports/:id/rollback then re-upload/apply; POST /admin/batteries/catalogue after archiving; POST /admin/batteries/catalogue/:id/transition RESTORE

**Scenario:** 1) Import a catalogue file, apply it (creates BL-49FT as DRAFT with an active CANONICAL alias row 'BL49FT'). 2) Roll the import back: rollback archives the battery via transition(ARCHIVE) which only updates battery_profiles and products; battery_aliases rows stay is_active=true. 3) Re-upload the corrected file: preview says CREATE_BATTERY (resolveCode excludes ARCHIVED), apply calls create(): aliasOwners() (repo line 285) also excludes ARCHIVED so it passes, then repo.create inserts a CANONICAL alias 'BL49FT' and Postgres raises duplicate key on battery_aliases_active_idx (migration line 193: UNIQUE (alias_normalised) WHERE is_active). The row is marked FAILED with the raw constraint text; every row of the re-import fails the same way. Quick Add of the same code on /admin/batteries/catalogue produces a 500 (non-BatteryOperationError is rethrown). Mirror case: RESTORE of the archived battery after another battery took the code is not checked against aliasOwners and dies on battery_profiles_code_idx with a 500.

**Why it is wrong:** The use case and readiness logic define 'archived batteries release their aliases' (aliasOwners filters lifecycle <> ARCHIVED) but the archive transition never deactivates the alias rows, so the database enforces the opposite rule; the two disagree and the operator is blocked with an unhandled error.

**Proposed fix:** In transition(): when next === 'ARCHIVED', deactivate every active alias of the battery (repo.setAliasActive for each, or a repo.deactivateAliases(productId)); when action is RESTORE/REOPEN from ARCHIVED, re-check aliasOwners for the canonical code and each alias to restore and refuse with ALIAS_CONFLICT if another non-archived battery now owns one. Test: BatteryCatalogueUseCases 'archive then create same code succeeds' and 'restore refused when code taken'.

### Maker/checker bypass: a verified claim edited while ARCHIVED keeps reviewedBy, so RESTORE returns it to READY and it can be published for a device nobody verified
`apps/api/src/application/use-cases/batteries/BatteryCompatibilityUseCases.ts:114` | authorization | finder confidence 0.75

**Reachable via:** PUT /admin/batteries/compatibility/:id (BATTERIES_COMPAT_PROPOSE) then POST /admin/batteries/compatibility/:id/transition RESTORE and PUBLISH (BATTERIES_PUBLISH)

**Scenario:** A creates claim (BL-49FT fits Spark 7), submits; B verifies FIT_TESTED -> READY (reviewedBy=B). Anyone archives it. A calls PUT /admin/batteries/compatibility/:id with { deviceId: <Spark 8> } (or evidenceStatus: 'VERIFIED_EXACT'): update() accepts it, and because before.workflowStatus is ARCHIVED (not READY/ACTIVE) the reset at line 114 is skipped, so reviewedBy/verifiedBy/verifiedAt stay set. RESTORE (CompatibilityWorkflow.ts line 102: verified = !!state.reviewedBy && evidence !== SUPPLIER_LISTED) moves it straight to READY; PUBLISH makes it ACTIVE; the finder shows 'Verified fit, in stock' for Spark 8 which B never checked. legacyConfidence projects 'verified' because verifiedBy/verifiedAt/evidenceSource are still present.

**Why it is wrong:** The domain contract (CompatibilityWorkflow header) is that a second person checks the evidence for the claim as it will be published; a material edit must invalidate the verdict regardless of the workflow status the claim happens to be in, otherwise the check is by UI state not by fact.

**Proposed fix:** In update(): apply the reset (workflowStatus DRAFT or keep ARCHIVED but null reviewedBy/reviewedAt/verifiedBy/verifiedAt/publishedBy, confidence 'declared') whenever isMaterialEdit(changed) and reviewedBy is set, independent of workflowStatus; or refuse material edits on ARCHIVED claims (unprocessable CLAIM_ARCHIVED, 'restore or reopen first'). Test: BatteryCompatibilityUseCases 'material edit on archived verified claim clears verdict so RESTORE yields DRAFT'.

### INCLUDE on a held COMPATIBILITY row with no normalised value is accepted; apply then creates a brand and device named "undefined" before failing
`apps/api/src/application/use-cases/batteries/BatteryImportUseCases.ts:247` | data-integrity | finder confidence 0.8

**Reachable via:** POST /admin/batteries/imports/:id/rows/:rowId/resolve (PIM_MAP) via /admin/batteries/imports/[id] 'Include it', then POST /admin/batteries/imports/:id/apply

**Scenario:** A COMPATIBILITY import holds a compound row (BatteryImport.ts line 386 returns value: null; savePreview stores normalizedData = { hold }). The import page offers 'Include it (I have resolved it)' for every held row and only shows the canonical-code box for BATTERY_CATALOGUE, so the operator submits INCLUDE with override null. The guard at line 247 only runs when an override is present, so resolveRow passes; the repository (DrizzleBatteryImportRepository.ts line 143-146) sets status VALID and proposedAction CREATE_BATTERY. On apply, the row passes the filter (normalizedData { hold } is truthy) and applyRow's COMPATIBILITY case runs ensureBrand(String(data.deviceBrand)) = ensureBrand('undefined') and ensureDevice({ model: 'undefined' }) which are created and audited, then findPair('undefined', ...) throws invalid uuid and the row is marked FAILED with appliedRecordIds null, so rollback never removes them. The brand 'undefined' is ACTIVE and is listed by the public finder brand endpoint. The same shape lets a re-run of the dry run turn any INCLUDE-resolved value-less held row into VALID (savePreview line 114).

**Why it is wrong:** An import must never write garbage it cannot roll back; a row may only become VALID when it carries a complete normalised value for its import type, and apply must not touch the catalogue for a row whose data came from a hold marker.

**Proposed fix:** In resolveRow(): refuse INCLUDE when the stored normalizedData has no value beyond hold/overridden for any import type (COMPATIBILITY/STOCK_*/PRICE_UPDATE cannot be repaired by override; require the source row to be fixed and re-uploaded), and require the override to yield a complete value for BATTERY_CATALOGUE. In apply(): filter rows to those whose normalizedData passes a per-type completeness check (batteryProductId/deviceBrand/deviceModel present for COMPATIBILITY) and mark others SKIPPED with a message. Wrap each COMPATIBILITY applyRow in one transaction so a failed claim insert does not leave brand/device rows. Test: BatteryImportUseCases.resolveRow rejects INCLUDE on a compound COMPATIBILITY row; apply never calls ensureBrand with 'undefined'.

### Receipt and count apply are not atomic: a concurrent second apply posts every line twice
`apps/api/src/application/use-cases/batteries/InventoryLedgerUseCases.ts:178` | concurrency | finder confidence 0.75

**Reachable via:** POST /admin/batteries/stock/receipts/:id/apply (INVENTORY_ADJUST); /admin/batteries/stock 'Apply to stock' form

**Scenario:** Operator double-clicks "Apply to stock" on /admin/batteries/stock (plain HTML form, no double-submit guard) or two operators apply the same draft receipt. Both requests read status DRAFT at line 178, both run the per-line applyMovement loop (each call is its own row-locked transaction, so both succeed), and markReceipt (DrizzleInventoryLedgerRepository.ts line 170) sets APPLIED unconditionally with no WHERE status = 'DRAFT'. A receipt of 20 units adds 40; two RECEIPT movements exist per line; receiptAlreadyApplied later reports the reference as already applied so the duplicate is never detected by the importer either. applyCount (line 248-276) has the identical shape; its second run writes a zero-delta COUNT movement per line rather than doubling, but the receipt case corrupts the balance.

**Why it is wrong:** Receipts must post exactly once; the DRAFT check is a read-then-act outside any lock and the state transition to APPLIED is not guarded, so the whole apply is not idempotent even though each individual movement is.

**Proposed fix:** Claim the receipt atomically before moving stock: add IInventoryLedgerRepository.claimReceipt(id, actorId) implemented as UPDATE stock_receipts SET status='APPLYING', applied_by=... WHERE id=$1 AND status='DRAFT' RETURNING *, and have applyReceipt refuse with RECEIPT_NOT_DRAFT when it returns null; then apply movements and set APPLIED (or run the whole apply inside one transaction with SELECT ... FOR UPDATE on stock_receipts and pass tx to applyMovement). Same for counts. Test: InventoryLedgerUseCases.applyReceipt called twice concurrently with a fake repo whose findReceipt returns DRAFT both times must produce exactly one set of movements.

### Publishing a partial config version silently wipes every other live value (preview shows a merged view that publish does not produce)
`apps/api/src/application/use-cases/delivery/DeliveryConfigUseCases.ts:328` | data-integrity | finder confidence 0.85

**Reachable via:** POST /admin/delivery/config/draft then POST /admin/delivery/config/:versionId/publish (DELIVERY_CONFIG_PROPOSE / DELIVERY_CONFIG_PUBLISH); also POST /admin/delivery/config/revert

**Scenario:** Launch values (5 keys + own_rider_max_band) are published as version V1. An operator later drafts one change via POST /admin/delivery/config/draft with only {same_day_cutoff_eat: '15:00'} (or any single-key expert edit, or accepts a revert to an old partial version). Preview computes effective = {...live, ...draft} and reports stillMissing = [] and 'Delivery would cost between ...', so the operator confirms. Publish marks V1 'superseded' and V2 'published'. DeliveryConfigReader.currentValues() reads registry defaults + ONLY V2's rows, so effective_speed_kmh, rider_cost_per_minute_ugx, handling_minutes, margin_multiplier, minimum_fee_ugx and own_rider_max_band all vanish: every metro quote becomes CONFIG_INCOMPLETE, checkout silently drops to the legacy zone fee (pricedBy legacy_fallback), and cross-field validation (free threshold vs minimum fee) is also evaluated against the draft alone so contradictory combinations pass.

**Why it is wrong:** DraftConfigVersionUseCase stores only the supplied keys; DrizzleDeliveryConfigRepository.publish supersedes all previously published versions; DeliveryConfigReader.currentValues layers only the single published version over registry defaults. The preview's `effective = { ...live, ...draft }` (line 163) and stillMissing are therefore computed on a value set that will never be live. Contract #7/#9 ('wrong numbers are cheap to fix', 'everything is reversible') is broken because a one-key edit destroys the launch configuration without any warning, and the mandatory preview actively misleads.

**Proposed fix:** Make a version a complete snapshot: in DraftConfigVersionUseCase (or DraftLaunchValuesUseCase) merge the currently published values under the supplied ones before createDraft, so every version carries every key; alternatively make DeliveryConfigReader.currentValues fold all versions in publish order (but then revert semantics change). Validate at publish against the full effective set. Pin with a unit test 'publishing a draft holding only same_day_cutoff_eat keeps the five launch values live' (DeliveryConfigUseCases + a fake repo + reader) and 'preview.stillMissing matches what currentValues() reports after publish'.

### F4 dispatch record never mirrors the order to 'dispatched', so the later DELIVERED mirror is always refused
`apps/api/src/application/use-cases/fulfilment/DispatchUseCases.ts:123` | correctness | finder confidence 0.85

**Reachable via:** POST /admin/fulfilment/:id/dispatch followed by POST /admin/fulfilment/:id/delivery

**Scenario:** Ops dispatch a READY_FOR_DISPATCH task through POST /admin/fulfilment/:id/dispatch (the path that enforces the COD/payment policy). RecordDispatchUseCase moves the TASK to OUT_FOR_DELIVERY directly and is wired without the order transition port (Registry line 1065), so the ORDER stays 'processing'. When the rider returns and ops POST /admin/fulfilment/:id/delivery with outcome DELIVERED, RecordDeliveryUseCase calls orderTransitions.transition(orderId, 'delivered'); OrderStateMachine only allows delivered from 'dispatched', OrderTransitionService throws, the use case swallows it and records orderTransition='skipped'. The order never reaches 'delivered': loyalty vesting on delivery confirmation never fires, delivery_quote_capture never gets an observation, calibration counts.deliveredOrders stays 0, and the awaiting-cost queue fills with 'skipped mirror' rows for every properly dispatched order.

**Why it is wrong:** The two dispatch paths have diverged: TransitionFulfilmentTaskUseCase (PATCH /:id/status) mirrors 'dispatched' onto the order; RecordDispatchUseCase (the recommended F4 path) does not. The order lifecycle is the canonical ledgered path that downstream effects (loyalty, calibration observations, failed-delivery metrics) subscribe to, so a dispatch that never reaches it loses those side effects silently.

**Proposed fix:** Inject IOrderTransitionPort into RecordDispatchUseCase (Registry.recordDispatchUseCase) and, after the task advances, call orderTransitions.transition(snapshot.orderId, 'dispatched', {source:'fulfilment', reasonCode:'dispatch_recorded'}) exactly as TransitionFulfilmentTaskUseCase does, recording orderMirror in the audit. Better: route the task advance through TransitionFulfilmentTaskUseCase so there is one place that mirrors. Pin with 'RecordDispatchUseCase moves the order to dispatched' and 'dispatch via F4 then DELIVERED yields orderTransition=delivered' in a use-case test with an in-memory order transition port.

### One env var is used both as the provider callback_url and as the API's redirect target, so PesaPal sends the paying customer straight to the storefront page, which then renders 'We could not confirm your payment' for every successful payment
`apps/api/src/application/use-cases/payments/StartPesaPalPaymentUseCase.ts:80` | correctness | finder confidence 0.75

**Reachable via:** Every online payment: POST /commerce/payments/pesapal/start -> PesaPal hosted page -> redirect to PESAPAL_CALLBACK_URL

**Scenario:** Production docs (docs/deployment/production-deployment.md:74, docs/passes/pesapal-payment-h1g.md:143) set PESAPAL_CALLBACK_URL=https://shopgoldplus.com/checkout/pesapal/callback (the Astro page). This use case hands that URL to PesaPal as callback_url. After the customer enters their PIN, PesaPal redirects to https://shopgoldplus.com/checkout/pesapal/callback?OrderTrackingId=...&OrderMerchantReference=... The page (callback.astro:19-20) reads only `reference` and `status`; both are absent, so normalisePaymentReturnKind('') returns 'unknown_attempt' and the customer sees 'We could not confirm your payment. We cannot yet confirm this payment. Please do not pay again until we have checked. Send us your order number on WhatsApp', with NO order number, and the cart cookie is not cleared (next checkout re-adds the paid items). The API route GET /commerce/payments/pesapal/callback, which settles, stamps callbackReceivedAt and redirects with status=success, is never reached; the order is paid only when the IPN arrives or the 10-minute poller runs. The only other possible value (the API route) makes commerce.ts:986 redirect to itself with the wrong parameter names (trackingId vs OrderTrackingId) and the browser dies on an infinite redirect. There is no value of the single variable that works, and the QA harness stub (scripts/qa/pesapal-stub.mjs:122-125) never performs the provider-to-callback hop so nothing catches it.

**Why it is wrong:** callback.astro's contract (its header comment) is that the API has already settled and passes the settlement kind as `status`; the API's own contract (commerce.ts:982-1024) is that PesaPal calls the API first. Both require PesaPal's callback_url and the customer-facing redirect target to be two different URLs, but they are read from the same variable at StartPesaPalPaymentUseCase.ts:80 and commerce.ts:986. Result: a truthful-return-page programme (PaymentReturnTellsTheTruth.test.ts) that is unreachable in production, and every paying customer shown copy that implies their payment did not go through.

**Proposed fix:** Introduce a distinct configuration value for the provider callback (e.g. PESAPAL_PROVIDER_CALLBACK_URL, defaulting to `${API_PUBLIC_ORIGIN}/commerce/payments/pesapal/callback`) and pass THAT to submitOrderRequest in StartPesaPalPaymentUseCase (and the synthetic probe in Registry:2072); keep PESAPAL_CALLBACK_URL as the storefront landing page used by commerce.ts:986. Add a boot-time guard in config/env.ts that refuses a provider callback pointing at the storefront host, and refuses a storefront target pointing at the API. Pin with a test in tests/unit/pesapal-payment.test.ts asserting submitOrderRequest.callback_url is the API route, and extend scripts/qa/pesapal-stub.mjs so /stub-pay redirects to callback_url with OrderTrackingId/OrderMerchantReference and the harness asserts the customer lands on the 'Payment received' page.

### PesaPal's INVALID (status_code 0, also its answer for a transaction not yet paid) is written into the terminal 'invalid' state, so the poller closes live attempts at 10 minutes and a later COMPLETED can never be recorded
`apps/api/src/application/use-cases/payments/VerifyPesaPalPaymentUseCase.ts:227` | money | finder confidence 0.6

**Reachable via:** PaymentReconcileTicker (every 10 min) then POST/GET /commerce/payments/pesapal/ipn, GET /commerce/payments/pesapal/callback, POST /admin/payments/attempts/:ref/reverify

**Scenario:** Customer starts payment at 14:00 and is still on the PesaPal page (telco push delayed, wrong number the first time, wallet top-up). PesaPal v3 has no PENDING code: GetTransactionStatus returns status_code 0 / INVALID until the payment completes (DECISIONS.md itself equates INVALID with 'payment page abandoned'). At 14:10 ReconcilePendingPaymentsUseCase polls, this switch maps 0 to 'invalid', line 235 writes attempt status 'invalid' (terminal in PaymentAttemptState.TRANSITIONS), line 292 sets the order paymentStatus 'failed', and SettlePayment enqueues the ORDER_PAYMENT_FAILED customer message. At 14:12 the customer completes the payment; the IPN arrives, step 5 calls updatePaymentAttemptStatus(id, { status: 'completed' }) and assertAttemptTransition('invalid','completed') throws PAYMENT_STATE_ILLEGAL_TRANSITION; the IPN route answers 500 (PesaPal retries, every retry throws), the browser callback lands on unknown_attempt, ops re-verify throws the same error, and the poller no longer lists the attempt. Money left the wallet, the order stays failed, and no code path can ever repair it. Any provider response without a numeric status_code also lands in `default` and is treated the same way.

**Why it is wrong:** The reconciliation loop's stated rule (ReconcilePendingPaymentsUseCase header, DECISIONS.md) is 'time never marks a payment failed' and 'every non-terminal state has an exit'. Mapping the provider's not-yet-paid answer to an exitless terminal state makes the 10-minute poll a timeout-failure in effect, and PaymentAttemptState's refusal to resurrect a terminal attempt then converts a real completed payment into a permanent 500. PesapalPaymentJourney's 'terminal attempt refuses resurrection' test pins the mechanism but not this outcome.

**Proposed fix:** Treat status_code 0 as non-terminal: map it to a state such as 'unpaid' (or keep 'pending') that permits -> completed | failed | reversed and is still pollable, and let the existing abandonment/TTL windows (order_abandonment_hours) close it; alternatively add 'invalid' -> 'completed' | 'reversed' to TRANSITIONS so a provider COMPLETED is always writable. Do not enqueue ORDER_PAYMENT_FAILED on a code-0 answer. Pin with tests/integration/PesapalPaymentJourney: 'an INVALID answer at poll time followed by COMPLETED still settles the order and runs the effects', and extend the PaymentAttemptState exhaustiveness test to assert 'completed' is reachable from every non-reversed state.

### A completed payment on an order that can no longer transition (e.g. cancelled) returns ok:true, so settlement confirms it, runs every success effect and tells the customer 'Payment received' while nothing surfaces the conflict
`apps/api/src/application/use-cases/payments/VerifyPesaPalPaymentUseCase.ts:260` | money | finder confidence 0.75

**Reachable via:** POST/GET /commerce/payments/pesapal/ipn, GET /commerce/payments/pesapal/callback, PaymentReconcileTicker, after POST /admin/orders/:id/transition to cancelled

**Scenario:** Order in 'received' with a pending PesaPal attempt; an operator cancels it via POST /admin/orders/:id/transition {toStatus:'cancelled'} (legal: received -> cancelled). Minutes later the customer completes the mobile-money payment. IPN -> provider says COMPLETED -> orderTransition.transition(orderId,'processing') throws DomainError ORDER_TRANSITION_ILLEGAL_TRANSITION (cancelled is terminal). This branch writes paymentStatus='paid' on the cancelled order and returns ok:true/status:'completed'. SettlePaymentUseCase -> ReconcileOrderPaymentUseCase sees ok + 'completed' with the checkout still at PAYMENT_STARTED, advances it to ORDER_CONFIRMED and returns CONFIRMED; markFulfilmentPaid, settleLoyalty (redemption consumed), enqueueAdminEmail('payment-confirmed'), recordMeasurement (revenue reported) and the ORDER_PAYMENT_SUCCESS customer message all run, and the browser callback redirects to status=success: 'We have your payment. We will call or message you when it is on its way.' The LIFECYCLE_CONFLICT message is discarded by every caller (commerce.ts:1003 `void result`, the IPN, the poller), no log or alert fires, and the ops queue shows no disagreement (ours 'completed' = provider 'completed'). Money was taken against a cancelled order and the only trace is an order row reading cancelled + paid.

**Why it is wrong:** The comment says 'record the payment fact only and surface it for manual reconciliation', but ok:true is the signal SettlePayment/Reconcile use to CONFIRM, so the conflict is not surfaced, it is celebrated. ReconcileOrderPaymentUseCase's central rule is that only a verified, applied payment progresses anything; here the lifecycle move was refused and everything progressed anyway.

**Proposed fix:** Return ok:false with a distinct status (e.g. 'lifecycle_conflict') from the DomainError branch so ReconcileOrderPaymentUseCase parks the checkout in PAYMENT_REVIEW (its `review()` path) and SettlePayment runs no success effects; log at error level and add the attempt to the ops queue (payments.ts /queue) as a disagreement row (attempt completed, order not processing). Optionally treat a completed payment on a cancelled order as a refund candidate. Pin with a unit test in tests/unit/pesapal-payment.test.ts: 'COMPLETED on a cancelled order yields ok:false, no success effects, REVIEW_REQUIRED', and a ReconcileOrderPaymentUseCase test for the new status.

### Promotion versions accept priceFloorUgx 0, so any admin-created version discounts below the UGX 145,000 floor
`apps/api/src/domain/pricing/Pricing.ts:122` | money | finder confidence 0.85

**Reachable via:** POST /admin/pricing/definitions and POST /admin/pricing/definitions/:id/versions (admin pages /admin/pricing, /admin/pricing/[id])

**Scenario:** Operator creates version 2 of launch-10 from /admin/pricing/[id] (the page hardcodes priceFloorUgx: 0 in its payload; /admin/pricing defaults the field to 0) with PERCENTAGE_OFF 1500. validatePromotionVersion and the admin zod schema (priceFloorUgx: z.number().int().min(0)) accept it; after approve/activate, PricingEvaluator computes available = base - prior - 0 * qty, so a 150,000 product is charged 127,500 and the storefront (which reads priceFloorUgx from the same version) advertises 127,500. scripts/activate-launch-discount.ts also created the live promotion with priceFloorUgx: 0. STOREFRONT_PRICE_FLOOR_UGX is enforced only in the battery domain, never on the promotion path.

**Why it is wrong:** The owner's per-unit floor of UGX 145,000 must hold on every path that yields a customer price; the evaluator's only floor is the per-version value, and nothing in domain or use case pins it to the shared constant.

**Proposed fix:** In validatePromotionVersion require input.priceFloorUgx >= STOREFRONT_PRICE_FLOOR_UGX (import from @goldplus/shared), or have PricingGovernanceUseCase.create/createVersion clamp to Math.max(input, STOREFRONT_PRICE_FLOOR_UGX) and audit the applied floor; keep the zod min in step. Pin with Pricing.test 'a version whose priceFloorUgx is below 145,000 is rejected' and a PricingEvaluator test that a 10,000 bps benefit never takes a line below 145,000 * qty.

### A terminal checkout refusal poisons the intent: the customer cannot place any order for up to 12 hours **[FIXED 2026-08-27]**
`apps/api/src/infrastructure/db/repositories/DrizzleCheckoutIdempotencyRepository.ts:152` | correctness | finder confidence 0.75

**Reachable via:** POST /commerce/orders/create after any FAILED_FINAL outcome (PRICE_CHANGED after a 5-minute-old promo preview is the everyday path)

**Scenario:** Customer applies a promo code (storefront POST /pricing-preview persists a quote with the default 300 s TTL, EvaluateCartPricingUseCase.ts:49) and takes more than five minutes to finish the form. On submit, CheckoutUseCase.ts:241 throws PRICE_CHANGED, classifyDependencyError marks it terminal, and idempotency.fail() writes state FAILED_FINAL for the identity derived from the intent (checkoutOperationIdentity = principal + intentId). The storefront keeps the same intent cookie for 12 h (apps/web/src/lib/checkoutIntent.ts:86-95 reuses any valid cookie; it is cleared only on success) and re-renders with an empty previewQuoteId. Every later submission from that browser hits the same identity: an identical resubmission gets decideIdempotency -> TERMINAL -> 400 ORDER_FAILED; a corrected basket (different quote id, item removed, coupon cleared) gets CONFLICT -> 409 IDEMPOTENCY_CONFLICT 'Your basket changed since this checkout started. Please review it and submit again.' Reviewing and submitting again produces the same 409 forever, because the takeover UPDATE quoted here never matches a FAILED_FINAL row and the insert conflicts on identity. The same wedge follows PRODUCT_UNAVAILABLE (product withdrawn), PROMOTION_CHANGED, CAPACITY_UNAVAILABLE and PRICE_UNAVAILABLE. Only signing in/out (new principal) or waiting out the 12 h intent TTL frees the customer.

**Why it is wrong:** A permanently failed operation holds no commerce (orderId is null, nothing was reserved), so refusing a materially different request against it protects nothing; it only converts a one-off refusal into a multi-hour inability to buy. The refusal copy ('start a new checkout', 'submit again') promises a recovery the system does not offer, and the storefront has no way to mint a new intent short of success. The fingerprint-before-state rule in decideIdempotency (CheckoutPrincipal.ts:408) is pinned by tests/unit/CheckoutTrustedPrincipal.test.ts:209 for all states, but that test pins the decision function, not the end-to-end outcome, and the takeover predicate here is where the contract can be repaired without touching it.

**Proposed fix:** In claim(), add a third takeover branch: state = 'FAILED_FINAL' AND order_id IS NULL, allowed even when the fingerprint differs, resetting fingerprint, stage='CLAIMED', failure_reason=NULL, operation_state='IN_PROGRESS' (a fresh operation under the same identity). Keep CONFLICT semantics for COMPLETED/IN_PROGRESS rows, which do hold commerce. Alternatively (or additionally) have /orders/create return a distinct code for FAILED_FINAL so the BFF calls clearCheckoutIntent and mints a new intent. Pin with tests/unit/ExecuteCheckoutIntentUseCase.test.ts 'a corrected basket after a terminal refusal claims a fresh operation and creates an order' and a repository test on claim() against a FAILED_FINAL row with a different fingerprint.

### Admin product edit silently drops slug, descriptions, stock status, active and more, then records a redirect to a slug that does not exist
`apps/api/src/infrastructure/db/repositories/DrizzleProductRepository.ts:111` | data-integrity | finder confidence 0.9

**Reachable via:** PUT /admin/products/:id (admin page /admin/products/[id]/edit-properties)

**Scenario:** Operator opens /admin/products/[id]/edit-properties, changes the slug from gp-power-bank to gp-powerbank-20000, rewrites the long description and sets stock status to Out of Stock, and saves. PUT /admin/products/:id builds a full ProductEntity and calls updateProductProperties -> save(), whose onConflictDoUpdate set only writes sku, modelNumber, name, categoryName, priceUgx, approvalStatus. slug, shortDescription, longDescription, subcategory, compareAtPriceUgx, stockStatus, imageUrl, active, isPreOrderEnabled, hasRetailPrice, hasImage stay at their old values. The route still returns 200 'Product properties saved.' and audits newState.slug = gp-powerbank-20000. Because existingProduct.slug !== slug, RecordProductSlugChangeUseCase inserts a 301 /p/gp-power-bank -> /p/gp-powerbank-20000. A customer opening /products/gp-power-bank now hits the 404 handler, resolve-redirect sends them to /products/gp-powerbank-20000, which has no product: the indexed product URL is dead. A product whose price was raised from 0 also keeps hasRetailPrice=false so its public price stays null and EvaluateCartPricingUseCase refuses it with PRICE_UNAVAILABLE.

**Why it is wrong:** A mutation that reports success and writes an audit newState must persist what it claims; the storefront and the SEO redirect table now disagree with the products row, and the slug-change 301 (U6 AC6) points at a URL that will never resolve.

**Proposed fix:** Make the upsert's set clause cover every column the entity carries (slug, subcategory, shortDescription, longDescription, compareAtPriceUgx, stockStatus, imageUrl, active, isPreOrderEnabled, hasRetailPrice, hasImage, specifications, updatedAt) or replace save()+updateProductProperties with an explicit UPDATE inside one transaction with the productPrices write; record the slug redirect only after the row confirms the new slug. Pin with an integration test 'updateProductProperties persists slug/description/active/stockStatus' and a route test that a PUT slug change makes GET /products/<newSlug> resolve.

### createProduct inserts a placeholder category id that violates the products.category_id foreign key
`apps/api/src/infrastructure/db/repositories/DrizzleProductRepository.ts:84` | correctness | finder confidence 0.5

**Reachable via:** POST /admin/products (admin page /admin/products/new)

**Scenario:** POST /admin/products validates the real categoryId, then createProduct calls save(), whose INSERT writes categoryId '00000000-0000-0000-0000-000000000000' and only afterwards UPDATEs the real id. products_category_id_categories_id_fk (migration 0000_fuzzy_switch.sql line 289) is NOT DEFERRABLE, and no migration, baseline or seed inserts a categories row with that id (the only other repo-wide occurrence is a drizzle meta prevId). The INSERT raises a foreign-key violation, the route's catch returns 500 'An unexpected error occurred.', and no product is created.

**Why it is wrong:** The insert path depends on a row nothing provisions; the real categoryId is already known at the call site and should be written in the same statement.

**Proposed fix:** Give save() a categoryId parameter (or split insert/update), write the real categoryId in the INSERT, drop the follow-up UPDATE, and wrap the products + productPrices writes in one transaction. Pin with an integration test that POST /admin/products succeeds on a database seeded only by migrations.

### SMS password reset never finds accounts registered with +256/256/9-digit phone shapes
`apps/api/src/infrastructure/db/repositories/DrizzleUserRepository.ts:27` | correctness | finder confidence 0.85

**Reachable via:** POST /auth/register then POST /auth/password/forgot-sms (storefront /register and /forgot-password)

**Scenario:** A customer registers with phone '+256 771 234 567'. RegisterCustomerUseCase accepts it (UG_PHONE_SHAPE allows +256, 256, 0 and bare 9-digit forms) and stores '256771234567' (line 75 only strips the '+'). Later they use /forgot-password with the same number: normalizeUgandanPhone gives '+256771234567'; findByPhone queries only ['+256771234567', '0771234567'], finds nothing, and RequestSmsPasswordResetUseCase returns the generic acknowledgement with userFound=false. No SMS is ever sent, the customer is told 'If that number is on a GoldPlus account, we have sent it a 6 digit code', and because email has never delivered from production they have no way back in. The same happens for '256771234567' and '771234567' registrations. The unique constraint also lets '0771234567' and '256771234567' coexist as two accounts for one phone.

**Why it is wrong:** IUserRepository.findByPhone's contract says the implementation must match the shapes registration stores; registration stores four shapes and the lookup covers two. RegisterCustomerUseCase's comment claims it normalises 'to the storage form used by checkout' but it does not normalise at all beyond dropping '+'. Recovery by SMS is the only working recovery channel.

**Proposed fix:** Normalise at the write side: in RegisterCustomerUseCase use normalizeUgandanPhone(input.phone) and store e164 (or one agreed canonical form), and have DrizzleAdminUserWriteRepository/AdminUserManagementUseCase do the same. For existing rows, add a migration that rewrites users.phone to the canonical form (refusing where two rows would collide) and, until then, make findByPhone also search the '256'+national and bare national forms. Pin with a unit test on RegisterCustomerUseCase (input '+256 771 234 567' persists the canonical form) and an integration test that registration followed by requestSmsPasswordResetUseCase yields userFound=true for each accepted input shape.

### Customer session middleware ignores sessions_invalidated_after and is_active, so a password reset does not sign anyone out
`apps/api/src/interfaces/http/middleware/customerSession.ts:19` | security | finder confidence 0.9

**Reachable via:** GET /account/me and every route mounted with customerSessionMiddleware; storefront /account pages via resolveAuthenticatedCustomer

**Scenario:** An attacker (or an old device) holds a customer bearer token issued by /auth/login, which has a 7-day TTL (AuthenticateUserUseCase SESSION_TTL_SECONDS). The customer resets their password by SMS or link; the repository stamps users.sessions_invalidated_after and the page says 'you have been signed out on every device, including any you did not recognise'. The old token still passes customerSessionMiddleware, so GET /account/me, /account/orders, /account/addresses, /commerce/orders/:id, /consent-operating, /surveys and /behavioural-interventions keep answering for up to 7 more days. The storefront's resolveAuthenticatedCustomer() calls /account/me with that token, so the old browser also stays 'signed in' on the site. The same applies to an account an operator sets is_active=false: the 7-day token keeps working on every customer route because only the admin authMiddleware checks isActive and the cutoff.

**Why it is wrong:** The reset flow's own contract (PasswordResetUseCases header, IAccountRecoveryRepository.consumeAndSetPassword, reset-password.astro copy) promises that every session issued before the reset dies with it; the cutoff exists precisely for that and is enforced only on admin routes. The customer is told a false security claim and the reason for resetting (someone else in the account) is not fixed.

**Proposed fix:** In customerSessionMiddleware (and the bearerUser() helper in auth.ts used by /logout-all, /sessions and /mfa/*), load the user via userRepo.findById after verifying the token, and fail with 401 when !user, !user.isActive, or isInvalidatedByCutoff(verified.issuedAt, user.sessionsInvalidatedAfter). Pin with a hermetic route test: issue a token, call resetPasswordWithSmsCodeUseCase for that user, assert GET /account/me now returns 401 (customerSession.cutoff.test.ts).

### /auth/logout-all revokes only refresh families; the 7-day access tokens every device holds stay valid
`apps/api/src/interfaces/http/routes/auth.ts:314` | security | finder confidence 0.85

**Reachable via:** POST /auth/logout-all (called by apps/web/src/pages/admin/logout.ts)

**Scenario:** An administrator signs out on a shared machine. apps/web/src/pages/admin/logout.ts calls POST /auth/logout-all expecting 'every outstanding token for that user dies, not just this browser's'. logoutAll only sets revoked_at on auth_sessions rows; it never stamps users.sessions_invalidated_after. The bearer token that /auth/admin/login issued (7-day TTL from AuthenticateUserUseCase, not the 15-minute SESSION_LIFETIMES.accessTtlMs) still verifies, and authMiddleware's cutoff check passes because the cutoff is null. Anyone who captured that token (browser history of a shared machine, a proxy log, a stolen laptop) keeps full admin access for the remaining days. The route answers { revoked: N } as if the job were done.

**Why it is wrong:** SessionPolicy documents the immediate hard-revocation design: 'admin logout-everywhere sets sessions_invalidated_after; any token issued at or before that instant is dead now'. The only code that stamps the cutoff is the password-reset repository, so the 'log out everywhere' action does not do what its callers and its own doc comment say, and the access-token TTL that makes refresh rotation meaningful (15 min) is contradicted by the 7-day token the login use case issues.

**Proposed fix:** Add IUserRepository.invalidateSessionsAfter(userId, at) (UPDATE users SET sessions_invalidated_after = now()) and call it from a LogoutAllUseCase that also calls sessionService.logoutAll, used by /auth/logout-all and by any future disable-user path. Separately, align the login-issued access TTL with SESSION_LIFETIMES.accessTtlMs (or at least make the admin token short-lived and let the BFF use /auth/refresh). Pin with an integration test: admin login, POST /auth/logout-all, then GET /admin/users with the original bearer must be 401.

### Re-enrolling MFA needs no step-up, so a stolen bearer token replaces the TOTP secret and passes every step-up gate
`apps/api/src/interfaces/http/routes/auth.ts:346` | authorization | finder confidence 0.85

**Reachable via:** POST /auth/mfa/enrol then POST /auth/mfa/confirm with any bearer token; then any requireStepUp-guarded route (admin pricing approve/activate)

**Scenario:** An attacker holds a valid admin bearer token (7-day TTL) but not the administrator's authenticator. They POST /auth/mfa/enrol: MfaService.beginEnrolment calls upsertEnrolment unconditionally, which overwrites the confirmed secret (and resets confirmed_at). The response hands them the new secret. They compute a TOTP from it and POST /auth/mfa/confirm: confirm() sets confirmed_at and last_verified_at = now and issues fresh recovery codes to the attacker. requireStepUp('pricing_approval') now returns ALLOW for five minutes, so they can approve and activate pricing versions. Side effect: the real administrator's authenticator stops working and their recovery codes are void.

**Why it is wrong:** MfaPolicy states 'A privileged user cannot opt out... it is denied, not downgraded. This is the self-bypass denial.' Step-up exists to protect privileged actions from a session that has already been stolen; letting that same session rotate the factor without proving the old factor (or the password) makes the gate decorative. FINDINGS_REGISTER F7-04 describes the MFA build as closing the 'MFA-enforcement residual', so this is not a documented gap.

**Proposed fix:** In MfaService.beginEnrolment (or a BeginMfaEnrolmentUseCase), refuse with MFA_STEP_UP_REQUIRED when the existing record has confirmedAt set and isStepUpFresh(lastVerifiedAt, now) is false; alternatively require the current password in the enrol body and verify it with the hasher. Audit MFA_REENROLLED with the actor. Pin with a unit test on MfaService: confirmed record + stale lastVerifiedAt + beginEnrolment must throw/refuse and must not touch the stored secret.

### A second public quoting path (legacy zone/band estimate) still drives the checkout 'Delivery' row and 'Total to pay' while the order is charged the ONE service's fee
`apps/api/src/interfaces/http/routes/commerce.ts:131` | money | finder confidence 0.7

**Reachable via:** GET /checkout (SSR + browser) via GET /commerce/delivery-estimate; order placement via CheckoutUseCase

**Scenario:** Checkout SSR (checkout.astro line 508) and the browser (line 983) fetch /commerce/delivery-estimate for the chosen district and render it in the order-summary 'Delivery' row; a CONFIRMED delivery_zones fee is added into 'Total to pay' (renderEstimate). On the same page the DeliveryQuote component (stage 2, 'This delivery fee is fixed for this order') shows the quoting service's answer. CheckoutUseCase then charges the quoting service's fee whenever its answer is anything but CONFIG_INCOMPLETE. Example reachable today: district Gulu has an enabled delivery_zones row (fee 15,000) but the quoting service resolves it to bus_parcel with NO_RATE_CARD; the page shows 'Delivery UGX 15,000 / Total to pay goods+15,000', the order is created with delivery_fee 0 unconfirmed. Once launch values are published, any metro district with a zone row shows the zone fee in the totals and the model fee in the quote box, and charges the latter.

**Why it is wrong:** Contract #1 (exactly one thing answers 'what does delivery cost') and #2 (fee and window from one model) are violated on the customer's core journey: two services answer, the committed total is built from the one that does not charge. The DeliveryQuote component even sits under a row showing a different number.

**Proposed fix:** Remove the /commerce/delivery-estimate call from checkout.astro and drive the 'Delivery' row and grand total from the same /delivery/quote response (feeUgx, or 'confirmed before dispatch' when unavailable), or make GetDeliveryEstimateUseCase delegate to DeliveryQuotingUseCase and only fall back to the zone/band model on CONFIG_INCOMPLETE (the same rule CheckoutUseCase applies). Pin with a checkout page test that the delivery figure in the totals equals the /delivery/quote feeUgx for a stubbed quote, and a use-case test that the estimate endpoint returns the quoting service's answer when it is not CONFIG_INCOMPLETE.

### Open redirect after sign-in: returnTo=/\evil.com passes the startsWith('/') guard and browsers resolve it to https://evil.com/
`apps/web/src/pages/login.astro:68` | security | finder confidence 0.85

**Reachable via:** GET /login?returnTo=..., /register?returnTo=..., /auth/:provider/start?returnTo=...

**Scenario:** A phishing mail links to https://shopgoldplus.com/login?returnTo=/%5Cevil.com. The customer sees the real GoldPlus login page, signs in with real credentials, and the frontmatter redirects to Location: /\evil.com. Per the WHATWG URL relative-slash rule (verified locally: new URL('/\\evil.com','https://shopgoldplus.com').href === 'https://evil.com/'), Chrome, Firefox and Safari land the freshly signed-in customer on the attacker's site, which can then show a fake 'session expired, sign in again' page. The identical guard is copied in register.astro:22, auth/[provider]/start.ts:22 and auth/[provider]/callback.ts:33, so the social sign-in flow has the same hole.

**Why it is wrong:** The guard's own comment ('Only local paths: an open redirect here would be a phishing gift') states the intended contract; a leading '/' followed by a backslash is not a local path to any browser. The check is duplicated in four files with the same defect.

**Proposed fix:** Create one apps/web/src/lib/safeReturnTo.ts used by all four sites: accept only when value starts with '/' and its second character is not '/' or '\\', and additionally new URL(value, 'https://shopgoldplus.com').origin === 'https://shopgoldplus.com' (reject anything containing a backslash, '@' or control characters). Pin with a unit test containing '/\\evil.com', '//evil.com', '/%5Cevil.com' (should stay local after decoding rules are applied), and 'https://evil.com'.

### SSR login and recovery pages do not forward the client address, so the whole storefront shares one halved abuse budget: 5 sign-ins and 2 recovery calls per minute site-wide
`apps/web/src/pages/login.astro:26` | correctness | finder confidence 0.75

**Reachable via:** POST /login, /register, /forgot-password, /reset-password storefront pages (SSR) -> API /auth/login, /auth/register, /auth/password/*

**Scenario:** login.astro, register.astro, forgot-password.astro and reset-password.astro run server-side and call http://api:3000 with no X-Forwarded-For. In production (PROXY_TOPOLOGY_MODE=CADDY_EDGE, hops=1) resolveClientAddress sees an empty chain, no X-Real-IP, and falls back to the web container's socket address with confidence UNVERIFIED. publicAbuseControl then keys every storefront customer to the same bucket u:<web-ip> and limitFor halves the budget: auth-customer-login 10/min becomes 5/min, auth-recovery 5/min becomes 2/min. Concrete: one customer does forgot-sms (1) + reset-sms with a mistyped code (2) + reset-sms again (3): the third call is 429 and the page shows 'Too many requests, please try again later.' Any sixth sign-in attempt from any customer in the same minute is refused with 'Too many attempts. Please wait a few minutes'. The rec relay (apps/web/src/pages/api/rec/[...path].ts) already forwards X-Forwarded-For 'so abuse control can attribute per-visitor rather than per-web-container', which shows the API-side policy assumes per-client keys.

**Why it is wrong:** PublicEndpointPolicy documents its numbers as 'per-client budgets' and sized the recommendations family for relay collapse, but the auth and recovery families were not; the login lockout and abuse control are meant to refuse an attacker, not every customer. Refuses what it must allow on the core sign-in and account-recovery journeys under modest concurrency.

**Proposed fix:** In the four auth pages (and any other SSR relay to /auth/*), forward the real client address exactly as the rec relay does: headers['X-Forwarded-For'] = Astro.clientAddress (guarded with try/catch), so the API resolves a TRUSTED per-client bucket. Consider a shared apps/web/src/lib/forwardClient.ts helper. Pin with a unit test on resolveClientAddress showing hops=1 + XFF=<client> yields TRUSTED <client>, and an integration test that two different forwarded addresses get independent auth-customer-login budgets.

---

## Medium (28)

### Storefront discount ignores maximumDiscountUgx, so cards, PDP and cart show a lower price than the evaluator charges
`apps/api/src/application/pricing/StorefrontDiscountQuery.ts:40` | money | finder confidence 0.8

**Reachable via:** GET /commerce/storefront-discount consumed by ProductCard, products/[slug], cart, checkout, GpNav after an admin creates a capped site-wide promotion

**Scenario:** Admin creates a site-wide promotion: no conditions, no exclusions, no coupon, benefit { type: 'PERCENTAGE_OFF', value: 1000, maximumDiscountUgx: 20000 } (accepted by admin/pricing.ts benefit schema). resolveStorefrontDiscount treats it as the simple storefront discount and returns percentBps 1000 with no cap. ProductCard/PDP display salePriceUgx(400000, 1000, floor) = 360,000 and cart.astro shows 720,000 for two; PricingEvaluator caps the line discount at remainingCap 20,000 and charges 780,000. The checkout total is higher than every price the customer was shown.

**Why it is wrong:** The query's own contract is that only a promotion the display can mirror to the shilling qualifies; a capped benefit cannot be mirrored per unit, so it must return INACTIVE_DISCOUNT rather than an uncapped percentage.

**Proposed fix:** Add `b.maximumDiscountUgx == null` to both the qualifying predicate and the benefit lookup (and reject any second non-FREE_SHIPPING benefit on the same version). Pin with StorefrontDiscountQuery.test 'a capped percentage benefit is not advertised'.

### Battery pack verification has no maker/checker in the use case although the admin page states a second person must do it
`apps/api/src/application/use-cases/batteries/BatteryCatalogueUseCases.ts:330` | authorization | finder confidence 0.5

**Reachable via:** POST /admin/batteries/catalogue/:id/verify (BATTERIES_COMPAT_VERIFY)

**Scenario:** An operator holding both batteries.catalogue.manage and batteries.compatibility.verify creates a battery via Quick Add with codeStatus CONFIRMED (a select on the same form), then immediately clicks Verify on /admin/batteries/catalogue/:id. verify() only checks codeStatus and marks verificationStatus VERIFIED with verifiedBy = the creator. The page copy at catalogue/[id].astro line 327 ('A second person should do this, not the person who entered the battery.') is not enforced anywhere; found.profile.createdBy is available and never compared to actorId.

**Why it is wrong:** The repo rule is that four-eyes checks live in use cases, never only in the UI; the compatibility workflow enforces it by actor id, the battery verification that unlocks the BATTERY_UNVERIFIED readiness blocker does not.

**Proposed fix:** In verify(): if (found.profile.createdBy === actorId) throw forbidden('MAKER_CHECKER', 'The person who entered the battery cannot verify it against the pack.'); also refuse when found.profile.updatedBy === actorId changed codeStatus to CONFIRMED in the same session if that stricter reading is wanted. Test: BatteryCatalogueUseCases.verify refuses the creator.

### Public finder suggestions and /batteries/products/:slug expose unpublished (DRAFT/REVIEW/READY) batteries
`apps/api/src/application/use-cases/batteries/BatteryFinderUseCases.ts:204` | security | finder confidence 0.75

**Reachable via:** GET /batteries/finder/search, GET /batteries/products/:slug (public)

**Scenario:** Anonymous GET /batteries/finder/search?q=BL4 (3+ chars, no exact hit). batteryCandidates() returns every non-ARCHIVED battery (repo line 196) and tier 6 prefix matching in FinderRanking.ts line 121 runs over that set, so draft batteries created by the importer or Quick Add are suggested; line 204 fetches them with batteryPublic() which has no lifecycle filter and returns canonicalCode, slug and name. The page renders them as links to /products/<slug>. GET /batteries/products/<slug> then returns the full draft DTO (name, price, code, publicNotes, warranty, chemistry) with isPublished:false; only the web page hides it. fuzzyBatteries (repo line 213) correctly restricts to ACTIVE, so the two suggestion sources disagree.

**Why it is wrong:** The public API is documented (routes/batteries.ts header, IBatteryFinderRepository header) as returning only published, evidenced data; unpublished catalogue entries, provisional codes and internal draft names must not be enumerable from the storefront.

**Proposed fix:** In search(): when building suggestions, keep only batteries whose lifecycle is ACTIVE (filter input.batteries to ACTIVE before the tier-6 pass, or filter batteryList on b.lifecycleStatus === 'ACTIVE' && productApproved && productActive). In battery(): return null unless lifecycleStatus === 'ACTIVE' (the route already maps null to 404) or strip everything but isPublished for non-active. Tests: rankSearch prefix tier ignores DRAFT batteries; BatteryFinderUseCases.battery returns null for a DRAFT slug.

### Catalogue preview keys the resolution cache by the raw stock label but looks it up by the derived canonical code, so existing and ambiguous batteries are never detected for GP-/bare labels
`apps/api/src/application/use-cases/batteries/BatteryImportUseCases.ts:162` | correctness | finder confidence 0.85

**Reachable via:** POST /admin/batteries/imports/:id/preview (BATTERY_CATALOGUE)

**Scenario:** Source item 'GP-49FT' with no code column (the shop's own label format). preload() stores the resolveCode result under normaliseBatteryCode('GP-49FT') = 'GP49FT'. normaliseImportRow derives canonicalCode = displayCode('49FT') = 'BL-49FT' and calls ctx.resolveBattery('BL-49FT'), which looks up 'BL49FT' (line 155) and gets null. Verified with the pure functions: preload key GP49FT / lookup key BL49FT; for bare '49FT': 49FT / BL49FT. Result: every such row previews as CREATE_BATTERY with no 'Updates existing battery' warning even when BL-49FT already exists, and a code that resolves to two batteries is not flagged INVALID at preview; the approver signs off a preview that does not describe what apply will do (apply re-resolves and updates, or fails the row with AMBIGUOUS).

**Why it is wrong:** The dry run is the four-eyes artefact; it must be deterministic and describe the apply. The cache key and lookup key must be the same normalised form.

**Proposed fix:** Key the cache by every candidate form: in preload(), after resolving, store the result under normaliseBatteryCode(raw) and under each batteryCodeCandidates(raw) entry and under the normalised displayCode of the analysed line; or make resolveBattery look up batteryCodeCandidates(code) and stripCodeQualifier before giving up. Test: BatteryImportUseCases.preview with a fake repo containing BL-49FT and a row 'GP-49FT' yields UPDATE_BATTERY.

### Price rollback overwrites a price changed since the import, contradicting the documented 'reported, not clobbered' rule
`apps/api/src/application/use-cases/batteries/BatteryImportUseCases.ts:429` | data-integrity | finder confidence 0.8

**Reachable via:** POST /admin/batteries/imports/:id/rollback (PIM_ROLLBACK) on a PRICE_UPDATE session

**Scenario:** PRICE_UPDATE import sets BL-49FT from 150,000 to 160,000 (beforeSnapshot 150000, afterSnapshot 160000). An operator later edits the price by hand to 170,000. Someone rolls the import back: line 429 restores 150,000 unconditionally. The manual 170,000 is lost and the storefront shows 150,000; the rollback notes report nothing. The stock branch two cases above (line 421) does the live-vs-afterSnapshot check that this branch omits.

**Why it is wrong:** The rollback contract in the method's own doc comment (line 375) says anything touched since import is reported, not clobbered; price is the one field that directly moves money and is the one without the check.

**Proposed fix:** Before restoring, compare found.product.priceUgx with Number(afterSnapshot.priceUgx); if they differ, throw new Error(`${code} price changed since import (now X, import set Y); not restored.`) so the row is reported in notes like the stock case. Test: BatteryImportUseCases.rollback leaves a price that was changed after apply and records it in notes.

### Stale count applies a stock change without the operator reason the rule requires, because the reason gate is evaluated against the draft's system quantity, not the live balance
`apps/api/src/application/use-cases/batteries/InventoryLedgerUseCases.ts:258` | validation | finder confidence 0.6

**Reachable via:** POST /admin/batteries/stock/counts/:id/apply

**Scenario:** Draft a cycle count for BL-49FT when system = 10, counted = 10, reason left blank (allowed: no difference). A receipt of 5 is applied afterwards (live = 15). Apply the count: countBlockers at line 252 runs on the stored systemQuantity (10 vs 10, passes), then line 258 computes delta = 10 - 15 = -5 and line 264 writes reason 'cycle count: difference found'. Five units that physically arrived are written off with an auto-generated reason nobody typed, and the page text ('Any difference from the system needs a reason before it can be applied') is false for this path.

**Why it is wrong:** The domain rule (InventoryLedger.countBlockers) is that a line whose count differs from the system needs a reason; re-reading the live balance at apply time without re-running that rule lets the requirement be bypassed by time rather than by intent.

**Proposed fix:** In applyCount, after re-reading live stock build the blocker input with systemQuantity = live.stock and run countBlockers again; refuse with COUNT_STALE listing the lines whose live balance moved since the draft and now differ without a reason, so the operator re-counts or adds a reason. Test: applyCount refuses when live stock differs from the draft and the line has no reason.

### A failure after the order has committed releases the loyalty reservation the committed order's discount depends on
`apps/api/src/application/use-cases/commerce/CheckoutUseCase.ts:336` | money | finder confidence 0.5

**Reachable via:** POST /commerce/orders/create with redeemPoints (signed-in customer)

**Scenario:** Signed-in customer checks out with redeemPoints. savePricedOrder commits the order (with loyaltyDiscountUgx and loyaltyRedemptionId on the row, fenced link written, stage ORDER_CREATED). Then loyaltyRedemption.attach (line 316, a plain UPDATE on loyalty_redemptions) throws on a transient DB fault. The catch treats the whole block as not-committed: it releases the loyalty reservation (ReleaseRedemptionUseCase marks it 'released') and calls capacity.release on reservations already marked REDEEMED. The error propagates; ExecuteCheckoutIntentUseCase records FAILED_RETRYABLE with the order already linked, the customer retries, resume() picks up the committed order and returns AWAITING_PAYMENT for the discounted total. The order is paid at the reduced amount while the points were handed back to the balance and no reservation is attached to the order for SettlePaymentUseCase.settleLoyalty to consume.

**Why it is wrong:** The compensation branch does not distinguish 'order not committed' from 'order committed, post-commit bookkeeping failed'. Once savePricedOrder returns, the reservations are part of a durable order and must never be released; a bookkeeping failure should be reported and retried, not undone.

**Proposed fix:** Split the try: wrap only savePricedOrder in the compensating catch; after it returns, treat attach/velocity/recordQuote failures as non-fatal reported obligations (observer/outbox), never as reasons to release. Better: perform attachReservationToOrder inside savePricedOrder's transaction alongside the order insert so the link and the order commit together. Pin with a CheckoutUseCase unit test 'attach failure after a committed order does not release the redemption'.

### COD zone policy is bypassed by omitting the optional deliveryLocation: a pay-on-delivery order lands for a destination where COD is refused
`apps/api/src/application/use-cases/commerce/CheckoutUseCase.ts:219` | validation | finder confidence 0.5

**Reachable via:** POST /commerce/orders/create with paymentMethod 'offline' and no deliveryLocation

**Scenario:** An active delivery_zone_policy has cod_allowed=false (or a cod_max_order_value_ugx) for district X. A request to POST /commerce/orders/create with paymentMethod 'offline', deliveryArea 'Layibi, X', deliveryAddress '…' and no deliveryLocation (the zod schema marks it .nullish(), line 69 of commerce.ts) yields district = null, so both COD checks (here and line 286) are skipped and the order is created as an offline order to X. The storefront itself sends deliveryLocation: null when a guest's manual entry does not resolve to a district (apps/web/src/lib/checkout.ts:89), so this is not only a crafted-request path.

**Why it is wrong:** The COD rule is a fraud/prepayment control ('Above the zone's COD ceiling, prepayment is required: refused with a clear message, never silently converted'), but it is keyed on an optional client field rather than on the destination the server actually resolves; the quoting service already resolves the destination from deliveryArea/areaSlug for the fee, so the same request is priced for X while its COD policy is not applied.

**Proposed fix:** Resolve the destination once and use it for both fee and COD: take the district from deliveryLocation.district, else from the quoting capture's resolved area/district, and when paymentMethod is 'offline' and no district can be established, refuse with a clear COD_DESTINATION_UNKNOWN message (fail closed for the offline path only). Pin with a CheckoutUseCase test 'offline order without deliveryLocation to a COD-blocked district is refused'.

### A pending fee-variance agreement does not block dispatch, and agreement can still be recorded after the rider has left
`apps/api/src/application/use-cases/fulfilment/DispatchUseCases.ts:85` | correctness | finder confidence 0.6

**Reachable via:** POST /admin/fulfilment/:id/dispatch, PATCH /admin/fulfilment/:id/status, POST /admin/delivery/variance/:id/agreement

**Scenario:** Ops apply a variance above the absorption threshold (POST /admin/delivery/orders/:id/variance) -> record agreement='pending', order.delivery_fee unchanged. Nothing in RecordDispatchUseCase or TransitionFulfilmentTaskUseCase consults listPendingAgreement/listForOrder, so the task dispatches with the rider card showing the OLD total. Later ops POST /admin/delivery/variance/:id/agreement {agreed:true}; RecordVarianceAgreementUseCase only refuses when order.status is delivered/completed, so it applies the new fee to an order that is already out for delivery: the rider's collection amount and the order total now disagree at the door, which is the exact dispute the commitment exists to prevent.

**Why it is wrong:** The domain (DeliveryVarianceUseCases header, admin queue note 'These orders must not dispatch until the customer has agreed the changed fee') states agreement is required BEFORE dispatch, but the rule is enforced nowhere in a use case (repo convention: four-eyes/controls in use cases, never only in the UI).

**Proposed fix:** Add a port to RecordDispatchUseCase and TransitionFulfilmentTaskUseCase (for to=OUT_FOR_DELIVERY) that checks deliveryVarianceRepo.listForOrder(orderId).some(v => v.agreement==='pending') and refuse with VARIANCE_AGREEMENT_PENDING; in RecordVarianceAgreementUseCase also refuse when the fulfilment task is OUT_FOR_DELIVERY (or order.status==='dispatched'), not only delivered. Pin with 'dispatch refused while a variance is pending' and 'agreement refused once dispatched'.

### Generic status transition bypasses the dispatch payment policy and packing completion checks
`apps/api/src/application/use-cases/fulfilment/TransitionFulfilmentTaskUseCase.ts:47` | authorization | finder confidence 0.5

**Reachable via:** PATCH /admin/fulfilment/:id/status (ORDERS_MANAGE)

**Scenario:** An operator with ORDERS_MANAGE calls PATCH /admin/fulfilment/:id/status {toStatus:'OUT_FOR_DELIVERY'} on a READY_FOR_DISPATCH task whose paymentStatus is 'unpaid'. canTransitionFulfilment only checks the FORWARD table, so it succeeds: no dispatch record, no CASH_ON_DELIVERY acknowledgement, no PAYMENT_NOT_CLEARED refusal, order mirrored to 'dispatched'. Likewise PICKING->PACKED->READY_FOR_DISPATCH can be walked by status alone with unresolved fulfilment lines, consuming inventory (route line 126) for an order that was never packed.

**Why it is wrong:** FulfilmentDispatch documents 'an order that is not paid may only be dispatched under an explicit cash-on-delivery acknowledgement' and FulfilmentLine 'packing completion is forbidden while any quantity is unresolved', but both controls live only in RecordDispatchUseCase / CompletePackingUseCase and the older status endpoint walks past them.

**Proposed fix:** In TransitionFulfilmentTaskUseCase refuse to=OUT_FOR_DELIVERY unless a dispatch record exists (or delegate to RecordDispatchUseCase), and refuse to=READY_FOR_DISPATCH unless the packing session is COMPLETED/PARTIAL with no unresolved remainder; keep ON_HOLD/CANCELLED free. Pin with 'status transition to OUT_FOR_DELIVERY on an unpaid task without a dispatch record is refused'.

### The notification outbox worker also claims TELEMETRY_DISPATCH events and retires them as 'unroutable', racing the telemetry dispatcher that runs in the same tick
`apps/api/src/application/use-cases/outbox/ProcessOutboxBatchUseCase.ts:75` | data-integrity | finder confidence 0.65

**Reachable via:** OutboxTicker (every 30s) after any browser telemetry POST or a confirmed webhook purchase

**Scenario:** TrackBrowserTelemetryEventUseCase and EnqueuePurchaseEventUseCase insert outbox rows with eventType 'TELEMETRY_DISPATCH' (status pending, next_attempt_at now). OutboxTicker runs processOutboxBatchUseCase.execute() and telemetryDispatcher.processBatch() concurrently. claimDueBatch filters only is_processed=false, next_attempt_at<=now and NOT IN the checkout side-effect list, so it locks and claims up to 25 telemetry rows per tick (status 'processing', next_attempt_at pushed 5 min out). NotificationRouter.route('TELEMETRY_DISPATCH') hits `default` and returns [], so lines 95-101 markProcessed(event.id, { lastError: 'No channel mapping for this event type.' }) and count it as unroutable. The telemetry SELECT ... FOR UPDATE SKIP LOCKED (TelemetryDispatchService:84-97) either skips the locked rows or, having read them first (its lock is autocommit-scoped), later writes 'retrying' onto a row already marked is_processed=true; in every ordering the event gets at most one dispatch attempt and is then recorded as a processed success. A purchase event that failed once is lost rather than retried on the documented 30s/5m/15m/1h/6h schedule, and metrics count it as delivered. Masked today only because sGTM is unprovisioned and every dispatch fails anyway.

**Why it is wrong:** The header comment of this class explains exactly this failure for commerce events ('would find no route, mark them processed as unroutable, and report success while the work was discarded') and excludes them; telemetry events are the same shape (no channel, no recipient) but are not excluded. Two workers with overlapping claim predicates on one table is the at-least-once-with-loss pattern the lease design was meant to prevent.

**Proposed fix:** Add EVENT_TYPE_TELEMETRY ('TELEMETRY_DISPATCH') to the excludeEventTypes passed here (export it from a shared constant so the telemetry service and this worker cannot drift), or give the notification worker an explicit includeEventTypes list of routable types. Add a test to tests/unit/ProcessOutboxBatchUseCase.test.ts asserting the claim filter excludes TELEMETRY_DISPATCH, and an architecture test in OutboxReliabilityInvariants that every claimer's include/exclude sets are pairwise disjoint.

### A provider failure on the status lookup leaves the refund reservation 'requested' with nothing sent, and every retry with the same request is answered 'already requested, no second payout was sent'
`apps/api/src/application/use-cases/payments/RefundPesaPalPaymentUseCase.ts:148` | money | finder confidence 0.75

**Reachable via:** POST /admin/payments/attempts/:merchantReference/refund

**Scenario:** Operator posts a refund of 50,000 for reference GP-... with reason 'delivery fee variance'. reserveRefund inserts the 'requested' row (counted against the refundable balance and subtracted from revenue). getTransactionStatus times out (3s, breaker 'pesapal' shared with checkout) and throws; there is no try/catch here, so the use case throws, the route returns 500, no providerStatus is recorded and no audit row is written. The operator retries the identical request: the deterministic key sha256(reference|amount|reason) matches the stuck row, reserveRefund returns ALREADY_PROCESSED, and the response says providerStatus 'requested' and 'This refund was already requested; the original request stands and no second payout was sent.' No RefundRequest was ever sent to PesaPal. The ledger permanently shows 50,000 refunded, the customer never receives it, and nothing lists refunds that were reserved but never handed to the provider (hasOutstandingRefunds only drives re-verification, and the poller never looks at completed attempts, see the next finding).

**Why it is wrong:** The class comment justifies retaining a reservation only when the provider CALL may have moved money; a failed status lookup provably moved none, yet the row is retained with no marker, and ALREADY_PROCESSED then asserts a payout request that never happened. The same wrong answer is given when the earlier row was 'rejected' (NO_CONFIRMATION_CODE): a rejected row does not count against the balance but its key still blocks an identical retry.

**Proposed fix:** Wrap the status lookup like the RefundRequest call: on throw, recordProviderOutcome(refund.id, { status: 'rejected', providerStatus: 'STATUS_LOOKUP_FAILED' }) (no money could have moved before RefundRequest) and return a typed failure the route maps to 502; make reserveRefund's ALREADY_PROCESSED branch ignore rows with status 'rejected' (or include the key only for requested/settled rows) so a genuine retry is possible; audit both. Pin with tests/unit/PaymentReconciliation.test.ts (refund section): 'status lookup failure rejects the reservation and a retry sends the refund', and 'a rejected reservation does not block an identical retry'.

### Order number carries 16 bits of entropy per month against a UNIQUE column, so live checkouts randomly fail with 503
`apps/api/src/domain/commerce/Order.ts:133` | correctness | finder confidence 0.85

**Reachable via:** POST /commerce/orders/create (every order)

**Scenario:** orders.order_number is varchar(20).unique().notNull() (schema/commerce.ts:58). Two orders in the same calendar month whose random UUIDs share the first four hex characters produce identical order numbers. With n orders in a month the probability of at least one collision is about 1 - exp(-n^2/131072): 7% at 100 orders, 50% at 300, effectively certain at 1000. On a collision, savePricedOrder's INSERT (DrizzleOrderRepository.ts:167) raises 23505; CheckoutUseCase's catch releases the promotion/loyalty reservations and rethrows; ExecuteCheckoutIntentUseCase.classifyDependencyError does not recognise the pg error, so the claim is marked FAILED_RETRYABLE with reason CHECKOUT_ERROR and the route answers 503 ORDER_FAILED 'The order could not be completed. Please try again.' The customer's paid-for basket is refused at the last step for no reason they can act on; the retry only succeeds because a fresh UUID is drawn. The same 4-hex space is what makes order numbers enumerable in the finding above.

**Why it is wrong:** A customer-facing identifier that must be unique is derived from 16 random bits and a month; the uniqueness constraint then turns ordinary volume into spurious checkout failures. It also uses server-local (UTC) month rather than Africa/Kampala, so the first three hours of each EAT month are stamped with the previous month.

**Proposed fix:** Generate the order number from a monotonic per-month sequence or from >= 40 bits of the UUID (e.g. GP-YYYYMM-<8 hex>) computed with the EAT helper in packages/shared/src/time/eat.ts, keeping the domain pure (pass the number in from the use case or derive it from the id in a way that cannot collide). Also classify SQLSTATE 23505 on orders_order_number in savePricedOrder as a retryable dependency error so the customer sees a retry rather than a generic failure. Pin with a unit test that generates 2,000 Order.create numbers in one month and asserts no duplicates, and a repository test that two orders with colliding uuid prefixes both persist.

### PIM UPSERT writes any positive retail price onto a live product, below the 145,000 floor
`apps/api/src/domain/pim/PimImport.ts:83` | money | finder confidence 0.7

**Reachable via:** POST /admin/pim-imports -> mapping -> preview -> approval -> apply (pim.create/map/approve/apply)

**Scenario:** An UPSERT import row names an existing approved SKU with retailPriceUgx 99000. normalizePimRow accepts it (only > 0 and integer are checked), preview marks the row UPDATE, four-eyes approval passes, and applyRow updates products.price_ugx and product_prices.retail_price to 99,000 with hasRetailPrice true. findPublicViewList now serves the product at UGX 99,000 and EvaluateCartPricingUseCase charges it.

**Why it is wrong:** The spreadsheet is trusted for the price; the owner's storefront floor (STOREFRONT_PRICE_FLOOR_UGX, enforced for battery imports in BatteryImport.ts) is not applied on this import path.

**Proposed fix:** In normalizePimRow add `value.retailPriceUgx < STOREFRONT_PRICE_FLOOR_UGX` as a validation error (message naming the floor) so the row is INVALID at preview; pin with PimImport.test 'a retail price below the floor is refused'.

### Brand chip count includes supplier-listed unchecked fits while the page tells the customer it is the number of batteries "we have checked"
`apps/api/src/infrastructure/db/repositories/DrizzleBatteryFinderRepository.ts:67` | copy | finder confidence 0.8

**Reachable via:** GET /batteries/finder/brands; /battery-finder page

**Scenario:** Default config has showAwaitingVerification: true. Brand TECNO has 1 FIT_TESTED published fit and 4 published SUPPLIER_LISTED (unchecked) claims. brands() returns verifiedFits = 5; battery-finder.astro line 113 renders 'TECNO · 5' and line 117 says 'The number is how many batteries we have checked for that brand.' The per-device count on the same page (brandBySlug line 89, VERIFIED_PUBLIC only) shows '1 battery we have checked' for the phone, so the two numbers contradict each other on the next click.

**Why it is wrong:** Customer-facing copy must not state a fact the data does not support; the shared label for SUPPLIER_LISTED is 'Listed by the supplier, not yet checked by us', so counting it as 'checked' is an invented claim and the DTO field is misnamed for what it carries.

**Proposed fix:** Drop the awaiting clause from the verifiedFits count in brands() (use VERIFIED_PUBLIC only, matching brandBySlug and verifiedFitCount), and if awaiting listings are wanted for ordering, return them as a separate coverageCount used by orderBrands. Test: DrizzleBatteryFinderRepository.brands with showAwaiting true does not count SUPPLIER_LISTED in verifiedFits.

### Re-running the dry run discards the operator's override and reverts proposedAction, so an INCLUDE-resolved compound catalogue row is counted as valid but silently SKIPPED at apply
`apps/api/src/infrastructure/db/repositories/DrizzleBatteryImportRepository.ts:119` | data-integrity | finder confidence 0.75

**Reachable via:** POST /admin/batteries/imports/:id/preview after POST .../rows/:rowId/resolve

**Scenario:** Operator resolves a held compound catalogue row with INCLUDE + canonicalCode 'BL-49CI' (resolveRow stores { ...value, canonicalCode, overridden: true } and proposedAction CREATE_BATTERY). Anyone then clicks '2. Run the dry run' (the page shows it whenever status is MAPPED or READY_FOR_APPROVAL). savePreview recomputes normalizedData from the source row ({ sourceItem, codes, category, hold }) and proposedAction back to HOLD_COMPOUND, while the kept INCLUDE resolution makes the status VALID (line 114). The approver sees the row in 'What will be created' and validRows counts it; at apply, applyRow's BATTERY_CATALOGUE branch sees HOLD_COMPOUND and returns SKIPPED, so the battery the operator explicitly resolved is never created and the session still ends APPLIED.

**Why it is wrong:** The comment on line 105 promises operator resolutions survive re-previews; only the INCLUDE flag survives, the data it depended on is thrown away, producing a VALID row whose action cannot apply.

**Proposed fix:** In savePreview, for rows whose stored resolution is INCLUDE with an override, re-merge the override onto the recomputed value and re-derive proposedAction the same way resolveRow does (or store the override in its own column and have apply merge it). Alternatively refuse a re-preview while any row carries a resolution, forcing the operator to re-resolve. Test: preview -> resolve INCLUDE with override -> preview again -> row still CREATE_BATTERY with canonicalCode.

### A 'scheduled' publish goes live immediately; scheduledFor is stored and never honoured
`apps/api/src/infrastructure/db/repositories/DrizzleDeliveryConfigRepository.ts:87` | correctness | finder confidence 0.7

**Reachable via:** POST /admin/delivery/config/:versionId/publish with scheduledFor

**Scenario:** Operator publishes a fee change with body {previewConfirmed:true, scheduledFor:'2026-09-01T06:00:00Z'} intending it for next week. PublishConfigVersionUseCase passes scheduledFor through, publish() sets status='published' and publishedAt=now while merely storing scheduled_for; DeliveryConfigReader.publishedVersionId() picks it up on the next quote. Customers get the new fees now; the version list shows a future scheduledFor next to a version that is already live. No job anywhere reads scheduled_for (grep: schema + this repo + the route only).

**Why it is wrong:** The route validates and accepts a schedule, the reader's comment promises 'a draft or scheduled version is deliberately invisible here', and the registry describes 'the Control Centre's scheduled publish', yet the implementation applies the change at once. Operator is misled about when a price change takes effect (contract #7).

**Proposed fix:** Either refuse scheduledFor in PublishConfigVersionUseCase until scheduling exists (fail('SCHEDULING_NOT_SUPPORTED')), or implement it: store status='scheduled' with scheduled_for, have DeliveryConfigReader.publishedVersionId ignore it, and add a job that promotes scheduled versions whose time has passed (demote previous published in the same transaction). Pin with 'publish with a future scheduledFor does not change currentValues()' in a use-case test.

### The poller never revisits a completed attempt with an outstanding refund, so the completed->reversed edge and refund settlement depend entirely on the provider pushing an IPN or an operator pressing re-verify
`apps/api/src/infrastructure/db/repositories/DrizzlePaymentAttemptRepository.ts:123` | data-integrity | finder confidence 0.8

**Reachable via:** PaymentReconcileTicker after POST /admin/payments/attempts/:ref/refund

**Scenario:** A refund is requested and accepted by PesaPal (RefundPesaPalPaymentUseCase returns ok). The attempt stays 'completed' and the ledger row stays 'requested'. POLLABLE_ATTEMPT_STATUSES is ['pending','verification_pending'], so listAttemptsForReconciliation never returns this attempt and ReconcilePendingPaymentsUseCase never asks the provider about it. VerifyPesaPalPaymentUseCase's hasOutstandingRefunds re-check (line 96-99) only runs when something ELSE invokes verify for that tracking id. If PesaPal does not send an IPN for the reversal (or it is lost, the exact case the poller exists for), the refund stays 'requested' forever, settleRefundsForAttempt never runs, a total refund never cancels the order, the attempt never reaches 'reversed', and /admin/payments/queue shows no disagreement because both sides still read COMPLETED until someone re-verifies by hand.

**Why it is wrong:** RefundPesaPalPaymentUseCase's class comment, IRefundLedgerRepository.hasOutstandingRefunds's doc and docs/payments/DECISIONS.md all state that 'the reconciliation poller, which already watches every attempt, observes the reversal landing'. The repository query watches only two states, so the documented safety net does not cover refunds. Provider-push dependence is the failure class the poller was built to remove.

**Proposed fix:** Add a second listing to IPesaPalPaymentRepository, e.g. listCompletedAttemptsAwaitingRefund(limit) (join payment_refunds where status='requested'), and have ReconcilePendingPaymentsUseCase settle those through the same SettlePaymentUseCase path (source 'poll'); alternatively include 'completed' attempts with outstanding refunds in listAttemptsForReconciliation via an EXISTS subquery. Pin with tests/integration/PesapalPaymentJourney: 'the poller observes a REVERSED answer on a completed attempt with a requested refund and settles the ledger row'.

### A second SUCCESS webhook with a new reference for an already-paid order is neither recorded nor rejected: the order transition throws, the payment insert rolls back and the route returns 500
`apps/api/src/infrastructure/db/repositories/DrizzlePaymentRepository.ts:95` | money | finder confidence 0.55

**Reachable via:** POST /webhooks/payment/:provider (requires MTN_WEBHOOK_SECRET / AIRTEL_WEBHOOK_SECRET or grace mode)

**Scenario:** Order X is paid (status 'processing', paymentStatus 'paid') from webhook ref R1. The provider delivers a signed SUCCESS webhook for order X with providerReference R2 (customer charged twice, or a provider re-send under a fresh reference). RecordPaymentWebhookUseCase passes the amount check and finds no row for key mtn:R2, so this method inserts the payment row and calls transitionWithin(..., 'processing'); canTransitionOrder('processing','processing') is not allowed, OrderTransitionService throws DomainError ORDER_TRANSITION_ILLEGAL_TRANSITION, the transaction rolls back (payment row gone), the catch at line 150-158 does not match 'duplicate key', the error propagates, webhooks.ts's catch does not match MISSING_ORDER and rethrows, the provider gets HTTP 500 and retries indefinitely. The second charge leaves no payments row, no requires_review flag and no operator signal; the only trace is a 500 in the logs.

**Why it is wrong:** The webhook path is required to be idempotent and to surface anything it cannot apply; a real, authenticated payment fact must be recorded (at minimum as requiring review) rather than lost, and a provider must never be answered 500 for a question already answered. The use case's amount-mismatch branch shows the intended pattern (hold for review); a duplicate success has no such branch.

**Proposed fix:** In RecordPaymentWebhookUseCase, before recordWebhookOutcome, check the order's paymentStatus (extend OrderAmountResolver to return {totalUgx, paymentStatus}) and, when already 'paid', record the payment with requiresReview=true and no lifecycle move (the repository already skips the transition when requiresReview is set), returning ok with requiresReview so the route answers 200 and logs PAYMENT_WEBHOOK_UNVERIFIED_ACCEPTED_PENDING_REVIEW-style. Pin with tests/unit/RecordPaymentWebhook.test.ts: 'a second SUCCESS for a paid order is recorded for review and does not throw'.

### Transitioning a superseded version rewrites the definition status and can archive a live promotion
`apps/api/src/infrastructure/db/repositories/DrizzlePricingRepository.ts:121` | correctness | finder confidence 0.75

**Reachable via:** POST /admin/pricing/definitions/:id/{archive|approve|reject|submit|activate} with an older versionId (pricing.manage/approve/activate permissions)

**Scenario:** launch-10 v1 is ACTIVE. Operator pauses v1, creates v2, submits/approves/activates it: definition ACTIVE, activeVersionId = v2, v1 left PAUSED. An operator with pricing.manage then tidies up with POST /admin/pricing/definitions/:id/archive { versionId: v1, expectedRevision }. PricingGovernanceUseCase.transition only checks canTransitionPromotion(PAUSED, ARCHIVED) and that v1 belongs to the definition; the repo sets the definition row to status ARCHIVED with activeVersionId null although v2 is still ACTIVE. listActiveVersions requires definition.status = ACTIVE and activeVersionId = version.id, so the live 10% vanishes from checkout and the storefront. createVersion refuses ARCHIVED definitions and ACTIVE cannot transition to ACTIVE, so the promotion is bricked with no governed way back. The same mirror happens for approve/reject/submit on any old version.

**Why it is wrong:** The definition's status and activeVersionId are derived from whichever version was touched, not from the version that actually represents the definition; the use case, not the UI (which only offers detail.versions[0]), must refuse transitions on non-current versions.

**Proposed fix:** In PricingGovernanceUseCase.transition refuse (INVALID_TRANSITION) any version that is neither definition.activeVersionId nor the latest version number; in transitionVersion only mirror definition.status/activeVersionId when versionId equals the definition's current version. Pin with PricingGovernanceUseCase.test 'archiving a superseded version leaves the active version and definition status untouched'.

### Public catalogue readers ignore products.active, so deactivated products stay listed, searchable and purchasable
`apps/api/src/infrastructure/db/repositories/DrizzleProductRepository.ts:240` | correctness | finder confidence 0.5

**Reachable via:** GET /products, GET /products/:slug, GET /products/suggest, POST /commerce/pricing-preview and checkout pricing

**Scenario:** A product row has active = false (created via POST /admin/products with active:false and approvalStatus 'approved', or later flagged inactive; the SEO lifecycle reader treats active = false as discontinued and the sitemap and DrizzleProductRecommendationReader exclude it). findPublicViewList and findPublicViewBySlug filter on approvalStatus only, so GET /products lists it, GET /products/:slug serves it, /products/suggest suggests it, and EvaluateCartPricingUseCase.findPublicViewList({ids}) prices it for checkout. The catalogue and the sitemap/recommendation surfaces disagree about whether the product is on sale.

**Why it is wrong:** Publication gating must be one rule applied on every public read; a product other readers treat as withdrawn must not be reachable by slug, in search, or in checkout pricing.

**Proposed fix:** Add eq(products.active, true) to the where clauses of findPublicViewList and findPublicViewBySlug (the checkout pricing lookup goes through the same method). Pin with a DrizzleProductRepository test 'an approved but inactive product is not returned publicly'.

### Repository rethrows unique violations as a plain Error, so RegisterCustomerUseCase's 23505 branch is dead and a duplicate phone registers as a 500
`apps/api/src/infrastructure/db/repositories/DrizzleUserRepository.ts:61` | error-handling | finder confidence 0.8

**Reachable via:** POST /auth/register (storefront /register)

**Scenario:** Customer A already has phone '0771234567'. Customer B registers a new email with the same phone. users.phone is unique, Postgres raises 23505, DrizzleUserRepository.create catches it and throws new Error('USER_EMAIL_TAKEN') which has no .code. RegisterCustomerUseCase line 90 checks (error as {code?}).code === '23505', misses, and rethrows; the route has no handler so the API answers 500. register.astro maps anything that is not 409/400 to 'We could not create your account right now. Please try again in a moment.', so the customer retries indefinitely instead of being told to sign in or that the phone is in use. The same happens for a raced duplicate email.

**Why it is wrong:** Two guards for the same condition disagree on the contract (one duck-types pg's code, the other strips it), so the intended 409 ALREADY_REGISTERED path ('An account with this email or phone already exists. Sign in instead.') can never execute. Duplicated logic that has already diverged.

**Proposed fix:** Either have the repository throw a typed error that preserves the code (class UniqueViolationError extends Error { code = '23505'; field: 'email' | 'phone' }) and match on it in the use case, or drop the repository's catch entirely and let the pg error propagate to the existing 23505 duck-type. Pin with a unit test on RegisterCustomerUseCase using a fake repo that throws the repository's real error shape and expects ALREADY_REGISTERED.

### /setup reports quotingEnabled=true while own_rider_max_band is unset and every metro quote is CONFIG_INCOMPLETE
`apps/api/src/interfaces/http/routes/admin/delivery.ts:62` | correctness | finder confidence 0.75

**Reachable via:** GET /admin/delivery/setup (REPORTS_READ)

**Scenario:** An operator publishes the five LAUNCH_KEYS through expert mode without own_rider_max_band (mandatory, Tier 2, ships null). GET /admin/delivery/setup uses missingLaunchKeys (LAUNCH_KEYS only) and returns quotingEnabled:true, blockedBy:null. Meanwhile DeliveryQuotingUseCase resolves mode=null for every corridor area and quoteFulfilment returns CONFIG_INCOMPLETE naming own_rider_max_band, so customers keep seeing 'We are finalising delivery pricing' and checkout keeps using the legacy fallback. The dashboard says the module is live when it is not.

**Why it is wrong:** Activation is gated by every mandatory registry key (missingMandatoryKeys exists for exactly this and includes own_rider_max_band), but the setup report checks only the five numeric launch keys. Contract #3 ('six numbers to launch') and 'no invented status'.

**Proposed fix:** In the /setup handler compute missing with missingMandatoryKeys(live) from DeliveryConfigRegistry (which covers own_rider_max_band) and surface it in launchValues; keep missingLaunchKeys for the numeric rows. Pin with a route/unit test: live values with the five launch keys but no own_rider_max_band -> quotingEnabled false, blockedBy CONFIG_INCOMPLETE listing own_rider_max_band.

### products.write can publish a product directly; products.publish is never enforced and there is no maker/checker
`apps/api/src/interfaces/http/routes/admin/products.ts:370` | authorization | finder confidence 0.6

**Reachable via:** POST /admin/products and PUT /admin/products/:id

**Scenario:** An operator holding only PERMISSIONS.PRODUCTS_WRITE PUTs (or POSTs) approvalStatus 'approved' for a product they just created or edited. The route writes approvalStatus straight to products via save(); findPublicViewBySlug/findPublicViewList gate solely on approvalStatus = 'approved', so the product is live on the storefront and purchasable. PERMISSIONS.PRODUCTS_PUBLISH exists in packages/shared/src/permissions but is referenced only by the control-centre module registry, never by a route or use case; the same actor makes and approves.

**Why it is wrong:** Publication moves a product into the public catalogue and must be gated by the publish permission and a checker distinct from the maker, enforced in a use case rather than left as a free-form field on the edit form.

**Proposed fix:** Strip approvalStatus from the create/update body; add a PublishProductUseCase (route POST /admin/products/:id/publish behind PERMISSIONS.PRODUCTS_PUBLISH) that refuses when actorId equals the product's last editor and audits before/after. Pin with a route test that products.write cannot change approvalStatus and a use-case test for the distinct-approver rule.

### No per-account attempt limit on /auth/mfa/verify: TOTP step-up can be brute-forced
`apps/api/src/interfaces/http/routes/auth.ts:386` | security | finder confidence 0.7

**Reachable via:** POST /auth/mfa/verify with any valid bearer token

**Scenario:** An attacker with a stolen admin bearer token (the case step-up exists for) posts six-digit codes to /auth/mfa/verify. verifyTotp accepts any of 3 codes per 30-second step (window +/-1), i.e. 3 in 10^6. Nothing counts failures: user_mfa.failed_attempts is reset to 0 in confirm() and recordVerification() but never incremented or checked, and the route is classified into the 'global' abuse family (1000/min per client). At 1000 guesses/min from one address the expected time to a hit is a few hours; with a handful of addresses it is under an hour, after which last_verified_at is stamped and every requireStepUp gate opens for five minutes.

**Why it is wrong:** A six-digit OTP is only safe with a small attempt budget and lockout (the SMS reset flow enforces exactly this, SMS_RESET_MAX_ATTEMPTS = 5); the schema anticipated a failed_attempts counter and the code never uses it. Same family gap in PublicEndpointPolicy: /auth/mfa/* falls into 'global' instead of an AUTH family.

**Proposed fix:** In MfaService.verify/useRecoveryCode, bump failed_attempts via a new IMfaRepository.recordFailure(userId) and refuse (MFA_LOCKED, 429 with Retry-After) once it exceeds e.g. 5 within 15 minutes, resetting on success; classify POST /auth/mfa/* as an AUTH family (limit 10/min) in classifyPublicEndpoint. Pin with a MfaService unit test (sixth wrong code is refused even if correct) and a PublicEndpointPolicy test for the new family.

### Every terminal business refusal is collapsed to ORDER_FAILED, so the customer is told to 'try again' for a permanent refusal and the storefront's specific copy is unreachable
`apps/api/src/interfaces/http/routes/commerce.ts:676` | copy | finder confidence 0.85

**Reachable via:** POST /commerce/orders/create

**Scenario:** A product in the basket is withdrawn (or a promo preview expires, or promotion capacity runs out). ExecuteCheckoutIntentUseCase returns { kind: 'FAILED_FINAL', reason: 'PRODUCT_UNAVAILABLE' }. The mapping table sends only mapped.code ('ORDER_FAILED') and mapped.message; outcome.reason is logged (line 693) but never placed in the body (line 705-709). The storefront's checkoutClient.ts switch has dedicated messages for PRICE_CHANGED, PROMOTION_CHANGED, PRODUCT_UNAVAILABLE and PRICE_UNAVAILABLE ('remove it from your cart and try again', 'check the new total') but can never receive those codes from /orders/create, so the customer sees 'We could not place your order. Please try again. You have not been charged. If it keeps failing, message us' and retries into the same refusal. The PRICE_REVIEW_REQUIRED entry at line 664 is dead: the use case never emits that kind (it emits FAILED_FINAL with reason PRICE_CHANGED).

**Why it is wrong:** The comment directly above (line 698-702) states 'A known business rejection is named by its CODE (the storefront maps it to its own wording)', and the shared CheckoutErrorCode union in packages/shared/src/types/checkout.ts enumerates PRICE_CHANGED/PROMOTION_CHANGED/PRODUCT_UNAVAILABLE/PRICE_UNAVAILABLE precisely so the storefront can react. Telling a customer to retry a refusal that cannot succeed is a false claim in customer-facing copy.

**Proposed fix:** For FAILED_FINAL, set the public code from outcome.reason when it is one of the shared CheckoutErrorCode values (PRICE_CHANGED, PROMOTION_CHANGED, PRODUCT_UNAVAILABLE, PRICE_UNAVAILABLE, DELIVERY_NOT_SUPPORTED, CAPACITY_UNAVAILABLE) and fall back to ORDER_FAILED otherwise; remove the dead PRICE_REVIEW_REQUIRED entry or make the use case emit it. Keep messages generic on the API side. Pin with a route test 'POST /orders/create maps FAILED_FINAL/PRODUCT_UNAVAILABLE to error.code PRODUCT_UNAVAILABLE' and a contract test that every CheckoutErrorCode the storefront switches on is producible by the route.

### Unbounded in-process quote cache keyed on unauthenticated user input never evicts
`apps/api/src/interfaces/http/routes/delivery.ts:26` | performance | finder confidence 0.7

**Reachable via:** POST /delivery/quote (public, no auth)

**Scenario:** POST /delivery/quote is public. fullKey is built from areaSlug (any string), district (any string), subtotalUgx (any number), hasPin and up to 100 productId x quantity pairs. Each distinct body inserts a new entry holding the whole response object; expiry is only checked on read at line 63 and nothing ever deletes. A client looping over subtotalUgx=1..N (or random areaSlug strings) grows the Map without bound; at the global rate limit that is roughly 1.4M entries/day per replica until the process is OOM-killed, taking every quote and the checkout adapter's process with it.

**Why it is wrong:** Unbounded data structure driven by user input; the TTL is not an eviction policy. The stated purpose (one basket shows one fee) needs only a small LRU.

**Proposed fix:** Replace the Map with a bounded LRU (e.g. max 5,000 entries, evict oldest on set, sweep expired on set), and normalise the key inputs (cap string lengths, round subtotal to the nearest 1,000 or omit it from the key since the quote already computes subtotal from items). Pin with a unit test that after MAX+1 distinct keys the cache size stays at MAX.

### Header featured card claims 'On sale now' and prints price -> same price when the floor removes the whole discount
`apps/web/src/components/GpNav.astro:457` | copy | finder confidence 0.7

**Reachable via:** Every storefront page header while a promotion is active

**Scenario:** The live promotion is 10% with priceFloorUgx 145,000 and the featured product's retail price is UGX 145,000 (the floor price many products sit at). navDeal.active is true, so the header renders small 'On sale now' and 'UGX 145,000 → UGX 145,000' because salePriceUgx returns the regular price when available = 0. ProductCard and products/[slug].astro gate on saleUgx < retail; this surface does not.

**Why it is wrong:** The owner rule 'a sale only when the price drops' (sale-only-when-price-drops) forbids announcing a discount that saves nothing; this is the one remaining consumer of salePriceUgx that skips the saving gate.

**Proposed fix:** Compute featSale = salePriceUgx(...) and render the arrow/'On sale now' only when featSale < priceUgx, otherwise fall back to the label/blurb branch. Pin with a GpNav render test for a product priced at the floor. (File is adjacent to the slice; reported because it is a caller of storefrontDiscount.ts.)

---

## Low (24)

### Whole-number percent rounds a 12.5% promotion up to a '13% discount' badge
`apps/api/src/application/pricing/StorefrontDiscountQuery.ts:49` | copy | finder confidence 0.7

**Reachable via:** GET /commerce/storefront-discount and every sale badge consumer

**Scenario:** Admin activates a site-wide PERCENTAGE_OFF of 1250 bps. The query returns percent 13; ProductCard, RecommendationCard, products/[slug].astro render '13% discount' badges and GpNav shows 'Everything in the shop −13%', while salePriceUgx and the evaluator take 12.5%. A 200,000 product shows 175,000 next to a '13%' claim.

**Why it is wrong:** Customer-facing copy must not overstate the discount; the badge must match the charged percentage.

**Proposed fix:** Return percent as benefit.value / 100 (one decimal) and format on the web, or only expose percent when value % 100 === 0 and otherwise render from percentBps; pin with a StorefrontDiscountQuery test for 1250 bps.

### Landmark requirement for area-linked addresses is skipped on create when landmarkText is omitted
`apps/api/src/application/use-cases/addresses/AddressUseCases.ts:76` | validation | finder confidence 0.6

**Reachable via:** POST /account/addresses

**Scenario:** POST /account/addresses with {areaSlug:'ntinda-kampala', ...} and no landmarkText key at all: routes/account.ts maps a missing key to undefined, validateCore treats undefined as 'unchanged' (patch semantics) and accepts, so a structured address is created with no landmark line even though the rule says a structured address must carry one. Sending landmarkText:'' is refused, omitting it is not.

**Why it is wrong:** The patch-semantics shortcut is reused for creation; on create, absent is not 'unchanged'. Ugandan last-mile runs on landmarks (PART G field 6), and this row then feeds checkout's deliveryLocation.

**Proposed fix:** In AddAddressUseCase call validateCore with landmarkText: input.landmarkText ?? '' (create semantics) while UpdateAddressUseCase keeps patch semantics. Pin with 'creating an area-linked address without landmarkText is refused'.

### Rejecting an already-accepted proposal marks it rejected while the learned factor stays live
`apps/api/src/application/use-cases/delivery/DeliveryCalibrationUseCases.ts:268` | data-integrity | finder confidence 0.75

**Reachable via:** POST /admin/delivery/calibration/proposals/:id/reject

**Scenario:** Proposal P is accepted (factor written to delivery_learned_factor, status 'accepted'). A second operator, or a double-click, POSTs /calibration/proposals/P/reject. Unlike AcceptCalibrationProposalUseCase there is no status!=='pending' guard, so the row flips to 'rejected' with decided_by overwritten, yet the fitted value keeps pricing every quote. The queue now shows a rejected proposal whose value is in force.

**Why it is wrong:** A decision is history (repo comment: 'Decided proposals are untouched'); rejecting after acceptance neither reverts the factor nor is refused, so the audit trail and the live model disagree.

**Proposed fix:** Add `if (proposal.status !== 'pending') return fail('ALREADY_DECIDED', ...)` mirroring the accept path. Pin with 'reject after accept is refused'.

### Multi-line packed-quantity update applies partially when a later line fails
`apps/api/src/application/use-cases/fulfilment/PackingUseCases.ts:107` | data-integrity | finder confidence 0.55

**Reachable via:** PATCH /admin/fulfilment/:id/packing/packed

**Scenario:** PATCH /:id/packing/packed with three updates; line 1 and 2 are written and audited, line 3 throws EXCEEDS_ORDERED. The use case returns a 400, the UI shows an error and keeps the old form state, but lines 1 and 2 are already changed and their versions bumped, so the operator's next retry of the same payload fails with STALE_FULFILMENT_VERSION on lines 1 and 2. The comment promises validate-all-then-apply; the code does neither atomically.

**Why it is wrong:** A failed batch write leaves a half-applied result with no rollback and no signal in the error that some lines were applied.

**Proposed fix:** Validate every line (rehydrate + setPacked in memory) before any updateWithVersion, then apply; or run the loop inside a repository transaction and roll back on the first failure. Pin with 'a batch whose last line is invalid changes no line'.

### The beneficiary of a PLATFORM_ADMINISTRATOR grant request may approve it themselves
`apps/api/src/application/use-cases/identity/AdminUserManagementUseCase.ts:97` | authorization | finder confidence 0.5

**Reachable via:** POST /admin/users/grant-requests/:id/decide

**Scenario:** Admin A (auth.manage) POSTs /admin/users/<B>/roles with roleName PLATFORM_ADMINISTRATOR, creating a PENDING request with requestedBy=A for userId=B. Admin B (also holding auth.manage) POSTs /admin/users/grant-requests/<id>/decide APPROVED. The only check is requestedBy !== actorId, so B approves the grant of full platform administration to B. The audit row records decision only, not that decider == beneficiary.

**Why it is wrong:** Four-eyes on privilege escalation requires that the person receiving the privilege is neither the maker nor the checker; the use-case rule only excludes the maker, so a two-person collusion (or a beneficiary who talks a colleague into 'just raising the request') needs no independent approver. Maker/checker must be enforced in the use case, not the UI.

**Proposed fix:** In decideGrant, also refuse when request.userId === args.actorId (code MAKER_CHECKER, 'The user receiving the role cannot decide their own grant.'), and include userId/requestedBy/decidedBy in the ADMIN_ROLE_GRANT_DECIDED audit newState. Pin with a unit test on AdminUserManagementUseCase.decideGrant where actorId equals the request's userId.

### A non-UUID order id (e.g. an order number) on the account order and payment-start routes surfaces as a 500 instead of 404
`apps/api/src/application/use-cases/orders/CustomerOrderUseCases.ts:20` | error-handling | finder confidence 0.7

**Reachable via:** GET /account/orders/:id; POST /commerce/payments/pesapal/start

**Scenario:** A customer opens /account/orders/GP-202608-A1B2 (their order number, which is what every email, WhatsApp handoff and confirmation page shows). findByIdForUser binds the string to orders.id (uuid) via eq(orders.id, orderId); Postgres raises 22P02 invalid input syntax for type uuid. errorMapping.pgCategory does not classify 22P02, so app.onError returns 500 INTERNAL_SERVER_ERROR and captures to Sentry. The same happens for POST /commerce/payments/pesapal/start with body { orderId: 'GP-…' } through StartOrderPaymentUseCase.ts:145 (findByOrderId on checkout_idempotency.order_id uuid).

**Why it is wrong:** A malformed identifier is a not-found/validation outcome, not a server fault; each such request produces a false alarm for operators and a generic failure page for the customer.

**Proposed fix:** Validate the id shape in the use cases (GetMyOrderUseCase and StartOrderPaymentUseCase): if it is not a UUID return NOT_FOUND without querying, or, for the account route, resolve an order number scoped by userId (and(eq(orders.orderNumber, id), eq(orders.userId, userId))). Optionally classify 22P02 as VALIDATION in errorMapping. Pin with tests 'GET /account/orders/:orderNumber returns 404' and 'payments/start with an order number returns NOT_FOUND'.

### A held catalogue row included with a canonical-code override is created as PHONE with no alias because the hold value uses different keys than the apply path reads
`apps/api/src/domain/batteries/BatteryImport.ts:277` | correctness | finder confidence 0.7

**Reachable via:** POST /admin/batteries/imports/:id/rows/:rowId/resolve INCLUDE with canonicalCode, then apply

**Scenario:** Source item 'MIFI BIG / SMALL' is held as HOLD_COMPOUND with value { sourceItem, codes, category: 'MIFI_ROUTER' }. The operator includes it with canonicalCode 'ZTE-Li3730'. applyRow (BatteryImportUseCases.ts line 311-332) reads data.batteryCategory (undefined -> 'PHONE'), data.aliases (undefined -> none), data.name (undefined -> 'battery ZTE-Li3730'), so the MiFi battery is created under Phone Batteries and the stock label that customers and receipts use is never attached as an alias; the HOLD_CONFLICT value (line 280) has the same shape.

**Why it is wrong:** The hold value and the apply payload are two shapes of the same row; the resolved row should carry the same fields a normal CREATE_BATTERY row carries so the override only supplies what was missing.

**Proposed fix:** Emit the held value with the CREATE_BATTERY field names (batteryCategory, aliases: [sourceItem], name null, codeStatus 'PROVISIONAL', lifecycleStatus 'REVIEW') so the override merge yields a complete row; or in resolveRow re-run normaliseImportRow with the overridden code cell. Test: normaliseImportRow compound MiFi row -> resolve with code -> applyRow creates MIFI_ROUTER with the source label as alias.

### Customer-facing cutoff sentence contains an em dash
`apps/api/src/domain/delivery/DeliveryPresentation.ts:187` | copy | finder confidence 0.9

**Reachable via:** POST /delivery/quote -> DeliveryQuote.astro on product, cart and checkout pages

**Scenario:** After the configured same-day cutoff, every product page, cart and checkout renders q.cutoff.sentence (DeliveryQuote.astro line 134) containing ' — '.

**Why it is wrong:** Repo convention: no em/en dashes in customer-facing copy; every other registry sentence avoids them.

**Proposed fix:** Use a full stop or comma: `Today's ${clock} ${EAT_LABEL} cut-off has passed. This goes out on the next dispatch day.` Pin in the DeliveryPresentation test that no cutoff sentence matches /[–—]/.

### The Slice 3C reconciliation report treats every PesaPal-paid order as a discrepancy because PesaPal settlement never writes a `payments` row
`apps/api/src/domain/payments/PaymentReconciliation.ts:76` | correctness | finder confidence 0.7

**Reachable via:** GET /governance/admin/payments/reconciliation (PAYMENTS_READ)

**Scenario:** The first real PesaPal payment settles: payment_attempts row 'completed', order paymentStatus 'paid', and no row in `payments` (only DrizzlePaymentRepository.recordWebhookOutcome, the MTN/Airtel path, inserts there). GET /governance/admin/payments/reconciliation then reports healthy=false with an 'order_paid_without_success_record' finding for that order and for every subsequent PesaPal order, so the report is permanently unhealthy and a genuine discrepancy is indistinguishable from the noise. GetPaymentReconciliationUseCase also loads orders.findAll() and payments.findAll() unbounded on every call.

**Why it is wrong:** The report cross-checks against the webhook `payments` table while the only live provider records success in payment_attempts; it should count a completed attempt as a success record. An operator-facing health signal that is always red is an operator misled.

**Proposed fix:** In reconcilePayments, treat an attempt with status 'completed' for the order as a success record (build successByOrder from both payments and completed attempts), and bound the order/payment inputs (recent window or the same ATTEMPT_SAMPLE). Realign tests/unit/Slice03CPaymentReconciliation.test.ts to include a PesaPal-completed attempt case that must NOT produce order_paid_without_success_record.

### Measurement control tower reports a fabricated 'last event received: now' and unconditional HEALTHY queue status
`apps/api/src/infrastructure/admin/DrizzleMeasurementControlTowerRepository.ts:68` | copy | finder confidence 0.6

**Reachable via:** GET /admin/measurement-control-tower (summary) and /section/health

**Scenario:** An operator with reports.read opens GET /admin/measurement-control-tower (summary or section=health). With zero measurement events and an unresolved dead-letter backlog (dlqCountResult > 0 is surfaced as both eventsQueued and eventsFailed), the payload still says lastEventReceived = the current timestamp, lastQueueError = null and measurementQueueStatus = 'HEALTHY'. Nothing in the pipeline is consulted for any of the three. Likewise getPreferenceCentreSummary reports preferencesViewed = preferencesUpdated = the row count of customer_preferences, which is neither a view count nor an update count.

**Why it is wrong:** The port types lastEventReceived as Date | null precisely so 'no event yet' can be said honestly, and the same file writes '0 is honest' for fields it cannot compute. Inventing a timestamp and a health verdict misleads the operator the dashboard exists to inform (no invented facts rule).

**Proposed fix:** Derive lastEventReceived from max(measurementAuditLogs.createdAt) (null when empty), set measurementQueueStatus from the unresolved dead-letter count (e.g. 'DEGRADED' when > 0, 'NO_DATA' when no events), and report preferencesViewed as null/NOT_MEASURED rather than a row count. Pin with a repository integration test on an empty database expecting lastEventReceived null and a non-HEALTHY status.

### Battery code is validated to 80 characters but written into products.model_number varchar(50), so a 51 to 80 character code fails with a raw Postgres error
`apps/api/src/infrastructure/db/repositories/DrizzleBatteryCatalogueRepository.ts:96` | validation | finder confidence 0.75

**Reachable via:** POST /admin/batteries/catalogue; PUT /admin/batteries/catalogue/:id; import apply

**Scenario:** Quick Add (form maxlength 80, use case check at BatteryCatalogueUseCases.ts line 186 allows 80) or a DEVICE_NAMED import row whose cleaned label is longer than 50 characters. create() passes validation and the repository inserts products.model_number = canonicalCode; Postgres raises 'value too long for type character varying(50)' (migration 0000 line 48; 0125 widened devices.model_number, not products). The route rethrows non-BatteryOperationError as a 500; in an import the row is FAILED with the raw DB message. update() line 240 has the same write on code change.

**Why it is wrong:** Server-side validation must match the storage contract; the operator gets an unexplained 500 instead of a plain refusal.

**Proposed fix:** Either lower the canonical code limit to 50 in the use case and domain (BatteryImport.ts line 308) with a clear message, or store the code truncated only in products.model_number and keep battery_profiles.canonical_code as the source of truth (documenting that model_number is a projection). Test: create() with a 60-character code refuses with BAD_INPUT.

### Fee variance rewrites total_amount of an already-paid order with no settlement path
`apps/api/src/infrastructure/db/repositories/DrizzleDeliveryVarianceRepository.ts:89` | money | finder confidence 0.5

**Reachable via:** POST /admin/delivery/orders/:orderId/variance, POST /admin/delivery/variance/:id/agreement

**Scenario:** A prepaid (payment_status='paid', status 'processing') order gets an AREA_MISMATCH variance +5,000 that the customer agrees. orderForVariance only derives handedOver from delivered/completed, so applyFeeToOrder runs: total_amount rises 5,000 above the amount actually settled by PesaPal. riderCollectionAmount returns 'PAID, collect nothing', so the 5,000 is never collected; the mirror case (an absorbed reduction on a paid order) is never refunded. Order total and payment ledger now disagree permanently.

**Why it is wrong:** The variance design assumes the COD total on the rider card is the settlement; for prepaid orders the total is already settled and mutating it silently creates an uncollected receivable (or an unrefunded overpayment) that no report surfaces.

**Proposed fix:** In ApplyDeliveryVarianceUseCase read payment_status; for paid orders either refuse increases with VARIANCE_ON_PAID_ORDER (absorb per contract #6) or record the delta as a separate receivable/refund line instead of touching total_amount. Pin with 'variance on a paid order does not change total_amount'.

### startForTask resets a COMPLETED packing session to IN_PROGRESS despite the comment
`apps/api/src/infrastructure/db/repositories/DrizzleFulfilmentLineRepository.ts:100` | data-integrity | finder confidence 0.6

**Reachable via:** POST /admin/fulfilment/:id/packing/start

**Scenario:** Packing for a task is completed (session COMPLETED, task READY_FOR_DISPATCH). Someone opens the packing screen and presses Start again; packableGuard only blocks ON_HOLD/terminal, so the upsert rewrites status to IN_PROGRESS with a new startedAt while completedAt remains. GET /:id/packing now shows an in-progress session on a dispatch-ready task and the fulfilment report's packedTasks (count of COMPLETED sessions) drops by one.

**Why it is wrong:** The comment says only non-terminal sessions are restarted but the SET clause is unconditional; state regresses and the report undercounts.

**Proposed fix:** Add a `where` to the onConflictDoUpdate (drizzle supports `setWhere`/`targetWhere`) so the update applies only when status not in ('COMPLETED','PARTIAL'), or check the session status in StartPackingUseCase and return the existing session. Pin with 'start after complete leaves the session COMPLETED'.

### setStockQuantity leaves stock_status stale while the adjust path keeps it coherent (diverged duplicate)
`apps/api/src/infrastructure/db/repositories/DrizzleInventoryRepository.ts:90` | correctness | finder confidence 0.65

**Reachable via:** PUT /admin/products/:id then GET /products?inStock=true

**Scenario:** PUT /admin/products/:id with stockQuantity 0: setStockQuantity writes stock_quantity = 0 but stock_status stays 'in_stock' (the form's stockStatus is dropped by save()). GET /products?inStock=true filters on stock_status = 'in_stock' and still lists the product while its card derives availability from stockQuantity and shows out of stock. DrizzleStockAdjustmentRepository.adjust (line 31) already maps the number to 'out_of_stock'/'in_stock'; the two writers have diverged.

**Why it is wrong:** Two writers of the same on-hand number apply different rules to the coarse display status, so the public inStock filter and the availability shown on the card disagree.

**Proposed fix:** Apply the same CASE expression (stockStatus: sql`case when ${newStock} <= 0 then 'out_of_stock' else 'in_stock' end`) in setStockQuantity, or move that rule into one shared helper used by both repositories. Pin with a repository test 'setting stock to 0 marks the product out_of_stock'.

### PIM UPDATE changes a live product's slug without a redirect and without touching updated_at
`apps/api/src/infrastructure/db/repositories/DrizzlePimImportRepository.ts:486` | correctness | finder confidence 0.65

**Reachable via:** POST /admin/pim-imports/:id/apply

**Scenario:** An UPSERT row for an existing approved SKU carries a different slug. applyRow rewrites products.slug directly; unlike PUT /admin/products/:id it never calls RecordProductSlugChangeUseCase, so /products/<old-slug> 404s with no 301, and updated_at is not set so the sitemap lastmod (U6 AC2) stays stale for the moved URL.

**Why it is wrong:** The U6 AC6 contract is that a slug change 301s the old product URL; a second writer of products.slug bypasses it, and sitemap lastmod must reflect real modification time.

**Proposed fix:** When existing.slug !== data.slug, record the redirect through the slug-change use case (inject the SlugChangeRecorder into the apply path) inside the same transaction, and set updatedAt: new Date() on the update. Pin with a PIM apply test 'slug change creates a redirect row and bumps updated_at'.

### Capacity overview counts expired-but-unflipped RESERVED rows as consumed capacity
`apps/api/src/infrastructure/db/repositories/DrizzlePricingOperationsRepository.ts:28` | correctness | finder confidence 0.6

**Reachable via:** GET /admin/pricing/overview, GET /admin/pricing/definitions/:id (pricing.read)

**Scenario:** A version has globalLimit 100; 40 quotes were reserved and abandoned (status RESERVED, expiresAt in the past). Reservations only flip to EXPIRED lazily inside the next reserveQuote for that version, so until another checkout reserves, /admin/pricing/overview and the definition detail report reserved 40 / remaining 60 while reserveQuote's activePredicate would admit 100. The operator sees a promotion as nearly exhausted when it is not.

**Why it is wrong:** The admin figure and the enforcement figure use different definitions of an active reservation; the operator is shown a number the system will not act on.

**Proposed fix:** Apply the same predicate as reserveQuote (status = 'REDEEMED' OR (status = 'RESERVED' AND expires_at > now())) when counting reserved in capacityFor; pin with a repository test that an expired RESERVED row does not reduce remaining.

### Product-cost import validates the note then inserts NULL for it
`apps/api/src/infrastructure/db/repositories/DrizzleProductCostRepository.ts:184` | data-integrity | finder confidence 0.85

**Reachable via:** POST /admin/product-costs/import (product_costs.manage)

**Scenario:** An operator imports a cost row with note 'Supplier invoice INV-2291, landed incl. clearing'. The row passes the 500-character note check, the import reports accepted/applied 1, but the INSERT hard-codes ${null} for note and the plan row never carries it, so product_cost_entries.note is empty and the audit trail the note was meant to justify is lost.

**Why it is wrong:** Input that is validated and acknowledged as accepted must be persisted; silently discarding it misleads the operator about what was recorded.

**Proposed fix:** Carry note on ProductCostImportPlanRow and bind ${row.note} in the INSERT; pin with an importCosts test that the stored entry carries the note.

### Resuming a paused promotion re-activates it (including lifting a budget auto-pause) without the MFA step-up that activation requires
`apps/api/src/interfaces/http/routes/admin/pricing.ts:58` | security | finder confidence 0.5

**Reachable via:** POST /admin/pricing/definitions/:id/resume

**Scenario:** A version was auto-PAUSED by redeemQuote when budgetConsumedUgx reached budgetCapUgx, or paused by an operator. POST /admin/pricing/definitions/:id/resume with pricing.activate moves it PAUSED -> ACTIVE through the same use-case path as activate, sets the definition's activeVersionId and puts the discount back in front of every customer, but requireStepUp('pricing_approval') is applied only to approve and activate. A session that lacks a fresh MFA step-up (the control the comment says activation needs because it 'moves money for every customer') can resume.

**Why it is wrong:** The step-up rule stated in this file for activation is bypassed by an operation that has the identical effect (to: 'ACTIVE').

**Proposed fix:** Add 'resume' to STEP_UP_OPERATIONS (or key the step-up on the target status ACTIVE); pin with a route test that resume without step-up is refused.

### compareAtPriceUgx is never validated and priceUgx has no upper bound, so NaN/overflow reach the integer columns as a 500
`apps/api/src/interfaces/http/routes/admin/products.ts:244` | validation | finder confidence 0.7

**Reachable via:** POST /admin/products, PUT /admin/products/:id

**Scenario:** POST /admin/products with compareAtPriceUgx 'abc' yields NaN, which passes straight into the products INSERT and fails in Postgres; priceUgx 3000000000 passes Number.isInteger and >= 0 but exceeds int4 and fails the insert. Both surface as 500 SERVER_ERROR 'An unexpected error occurred.' instead of a validation message, and (via createProduct's non-transactional writes) can leave a products row with no product_prices row.

**Why it is wrong:** Parsed price inputs must be bounded integers before they reach a money column; the route validates priceUgx's sign but not its range and compareAtPriceUgx not at all.

**Proposed fix:** Validate compareAtPriceUgx (integer, >= 0, and >= priceUgx or absent) and cap priceUgx/compareAtPriceUgx at a sane maximum (e.g. 100,000,000) with 400 VALIDATION_ERROR; pin with route tests for 'abc' and out-of-range values.

### Replaying failed jobs and changing worker concurrency are mutating admin operations with no audit record, and the audit-exempt justification is not true
`apps/api/src/interfaces/http/routes/admin/queues.ts:59` | authorization | finder confidence 0.6

**Reachable via:** POST /admin/queues/replay, POST /admin/queues/concurrency

**Scenario:** An operator with SETTINGS_MANAGE posts /admin/queues/replay {queueName:'telemetry-dispatch'} (re-executing every failed job, including purchase-dispatch jobs) or /admin/queues/concurrency {concurrency:100}. QueueService.replayFailedJobs writes no log line at all and neither route calls CreateAuditLogUseCase, so afterwards nothing records who replayed what or when; the route's 'audit-exempt: logged via QueueService debug channels' comment does not hold for replay (no logging) and a log line is not an audit entry for concurrency either.

**Why it is wrong:** Repo rule: audit every material admin operation with before/after and actor. Mass re-execution of failed jobs and a 20x concurrency change are material and are unrecorded.

**Proposed fix:** Write an audit entry via registry.createAuditLogUseCase in /replay (entity 'queue', newState {queueName, replayed}) and /concurrency (previousState {concurrency: before}, newState {concurrency: after}), with the actor id; remove the audit-exempt comment. Pin with a route test in tests/unit/Slice08B1AdminRouteProtectionSweep.test.ts style asserting an audit row per call.

### /pricing-preview returns the raw error message (and pg error code) of any failure to unauthenticated callers
`apps/api/src/interfaces/http/routes/commerce.ts:301` | security | finder confidence 0.7

**Reachable via:** POST /commerce/pricing-preview (public)

**Scenario:** POST /commerce/pricing-preview while the database is unreachable or a query fails: the response body is { code: '08006' | 'ECONNREFUSED' | …, message: 'connect ECONNREFUSED 10.0.0.5:5432' } or a message carrying the failing SQL fragment, with HTTP 400. Only PricingEvaluationError messages are client-safe; every other error reaches the browser verbatim.

**Why it is wrong:** Repo rule: an unexpected error never returns err.message to a client (app.onError and errorMapping exist for exactly this); this handler bypasses it and also mislabels a dependency outage as a 400 caller error.

**Proposed fix:** Catch only PricingEvaluationError (or CheckoutDependencyError) and return its code with a fixed message; rethrow anything else so mapErrorToHttp produces the generic 503/500. Pin with a route test that a thrown pg-style error yields INTERNAL/DEPENDENCY_UNAVAILABLE with no message passthrough.

### Quote cache key ignores deliveryArea, so free-text destinations share one cached fee for 60 s
`apps/api/src/interfaces/http/routes/delivery.ts:51` | correctness | finder confidence 0.7

**Reachable via:** POST /delivery/quote with deliveryArea (not used by DeliveryQuote.astro or HeroSlider.astro today)

**Scenario:** POST /delivery/quote {deliveryArea:'Ntinda', items:[...]} (no areaSlug/district) resolves through DeliveryAreaResolver.byText and is cached under a key with a:none|d:none. A request within 60 s for {deliveryArea:'Kajjansi'} with the same basket hits the same fullKey and is served Ntinda's fee and window. The use case accepts deliveryArea precisely so free-text orders can be priced; current web callers do not send it, so this is API-reachable only.

**Why it is wrong:** The cache identity omits an input that changes the resolved area and therefore the fee, violating 'the same basket cannot show three fees' in the opposite direction (different destinations show one fee).

**Proposed fix:** Include the folded deliveryArea (foldUgandanOrthography) in the canonical key, or refuse to cache when only deliveryArea is supplied. Pin with a unit test on quoteCacheKey/fullKey that two different deliveryArea values yield different keys.

### Admin battery pages format timestamps in the server's zone (UTC in the container), three hours behind the Kampala time operators expect
`apps/web/src/pages/admin/batteries/stock.astro:59` | correctness | finder confidence 0.7

**Reachable via:** /admin/batteries, /admin/batteries/stock, /admin/batteries/demand, /admin/batteries/imports, /admin/batteries/imports/[id], /admin/batteries/catalogue/[id]

**Scenario:** A receipt applied at 14:05 EAT is shown as '11:05' on /admin/batteries/stock, the dashboard 'Recently changed', demand requests, import history and the battery timeline (same helper copied into demand.astro line 56, index.astro line 50, imports/index.astro line 60, imports/[id].astro line 55, catalogue/[id].astro line 92). A movement made after midnight EAT is listed under the previous day. The analytics admin page (pages/admin/analytics/index.astro line 371) passes timeZone: 'Africa/Kampala' for the same purpose, so this module diverges from the established convention.

**Why it is wrong:** Business time is Africa/Kampala; formatting with the process default on a UTC server gives the wrong local day and hour (repo convention, packages/shared/src/time/eat.ts).

**Proposed fix:** Add timeZone: 'Africa/Kampala' to the toLocaleString options in one shared helper (e.g. export formatEat from apps/web/src/lib/batteries.ts or reuse the shared eat.ts helper) and use it in all six pages. Test: helper formats 2026-08-26T11:05:00Z as 14:05.

### Device page fetches /finder/devices/:slug twice per view, recording two DEVICE_SELECTED demand events for every selection
`apps/web/src/pages/battery-finder.astro:68` | correctness | finder confidence 0.85

**Reachable via:** GET /battery-finder?device=<slug>

**Scenario:** A customer opens /battery-finder?device=tecno-spark-7. Line 44 calls /finder/devices/:slug to set the device cookie; line 68 calls the same endpoint again for rendering. BatteryFinderUseCases.device() (line 113) inserts a DEVICE_SELECTED event on every call, so each view counts twice in demandOverview ('Most searched phones', 'Phones with demand and no battery', brand demandCount used by orderBrands) and the search-to-product funnel denominators.

**Why it is wrong:** Demand figures are presented to the operator as anonymous counts of what people looked for; doubling device selections misstates them and skews FEATURED_THEN_COVERAGE ordering.

**Proposed fix:** Fetch the device once: reuse the line-68 result to set the cookie after Promise.all (or move the cookie write below and drop the line-44 fetch). Test: a page-level test asserting one call to /finder/devices per render, or make device() record only when a query flag is set by the rendering fetch.
