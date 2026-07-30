/**
 * Real-PostgreSQL proof for durable checkout side effects.
 *
 * Runs the ACTUAL DrizzleCheckoutSideEffectRecorder and the ACTUAL
 * DrizzleCheckoutIdempotencyRepository against a real PostgreSQL with migration
 * 0059 applied. None of these guarantees can be proven with a mock:
 *
 *   - the identity row and the outbox event commit TOGETHER (transaction)
 *   - a second attempt conflicts rather than duplicating (unique index)
 *   - a malformed write is FINAL, not retried forever (SQLSTATE classification)
 *   - finishing the workflow does NOT overwrite the saga stage (the
 *     false-completion regression)
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx tsx scripts/qa/checkout-side-effect-durability.ts
 *
 * Read-write against the target database, so point it at a scratch database — it
 * inserts rows under a random checkout identity and does not clean up, so the
 * evidence remains inspectable.
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { db, client } from '../../apps/api/src/infrastructure/db/client';
import { checkoutIdempotency, checkoutSideEffects } from '../../apps/api/src/infrastructure/db/schema/commerce';
import { outboxEvents } from '../../apps/api/src/infrastructure/db/schema/system';
import { DrizzleCheckoutSideEffectRecorder } from '../../apps/api/src/infrastructure/db/repositories/DrizzleCheckoutSideEffectRecorder';
import { DrizzleCheckoutIdempotencyRepository } from '../../apps/api/src/infrastructure/db/repositories/DrizzleCheckoutIdempotencyRepository';

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : `  (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`}`);
}

async function main(): Promise<void> {
  const recorder = new DrizzleCheckoutSideEffectRecorder();
  const idem = new DrizzleCheckoutIdempotencyRepository();

  const identity = randomUUID().replace(/-/g, '');
  const orderId = randomUUID();

  // -- 1. First record writes both halves ----------------------------------
  const first = await recorder.record({
    checkoutIdentity: identity,
    orderId,
    eventType: 'ORDER_FULFILMENT_REQUIRED',
    policyVersion: 'proof-v1',
    payload: { hold: false, warnings: [] },
    traceId: 'proof-trace',
  });
  check('first record is DURABLY_RECORDED', first, 'DURABLY_RECORDED');

  const rows = await db
    .select()
    .from(checkoutSideEffects)
    .where(eq(checkoutSideEffects.checkoutIdentity, identity));
  check('one identity row exists', rows.length, 1);
  check('the identity row names an outbox event', rows[0].outboxEventId !== null, true);

  const events = await db
    .select()
    .from(outboxEvents)
    .where(eq(outboxEvents.id, rows[0].outboxEventId as string));
  check('the named outbox event exists', events.length, 1);
  check('the outbox event carries the order', events[0].relatedEntityId, orderId);
  // Commerce work is not an outbound message. Marking it dry-run would make it
  // look suppressed to the outbound-governance surface.
  check('the outbox event is not dry-run', events[0].dryRunOnly, false);
  check('the outbox event is pending, not processed', events[0].isProcessed, false);

  // -- 2. A second attempt conflicts, it does not duplicate ----------------
  const second = await recorder.record({
    checkoutIdentity: identity,
    orderId,
    eventType: 'ORDER_FULFILMENT_REQUIRED',
    policyVersion: 'proof-v1',
    payload: { hold: false, warnings: [] },
    traceId: 'proof-trace-2',
  });
  check('a repeat record is ALREADY_RECORDED', second, 'ALREADY_RECORDED');

  const afterRepeat = await db
    .select()
    .from(checkoutSideEffects)
    .where(eq(checkoutSideEffects.checkoutIdentity, identity));
  check('still exactly one identity row', afterRepeat.length, 1);

  const allEvents = await db
    .select()
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.relatedEntityId, orderId),
        eq(outboxEvents.eventType, 'ORDER_FULFILMENT_REQUIRED'),
      ),
    );
  // This is the whole point: the business effect happens once.
  check('still exactly one outbox event', allEvents.length, 1);

  // -- 3. A different event type is independent ----------------------------
  const other = await recorder.record({
    checkoutIdentity: identity,
    orderId,
    eventType: 'ORDER_ADMIN_NOTIFICATION_REQUIRED',
    policyVersion: 'proof-v1',
    payload: { stockConfirmed: true },
    traceId: 'proof-trace',
  });
  check('a different event type records independently', other, 'DURABLY_RECORDED');
  check(
    'recordedTypes reports both',
    (await recorder.recordedTypes(identity)).sort(),
    ['ORDER_ADMIN_NOTIFICATION_REQUIRED', 'ORDER_FULFILMENT_REQUIRED'],
  );

  // -- 4. A malformed write is FINAL, not retried forever ------------------
  // A non-uuid order id violates the column type. Retrying cannot fix it, and
  // treating it as transient would burn eight attempts on a certain failure.
  const malformed = await recorder.record({
    checkoutIdentity: randomUUID().replace(/-/g, ''),
    orderId: 'not-a-uuid',
    eventType: 'ORDER_FULFILMENT_REQUIRED',
    policyVersion: 'proof-v1',
    payload: {},
    traceId: 'proof-trace',
  });
  check('a malformed write is FINAL_FAILURE', malformed, 'FINAL_FAILURE');

  // An unknown event type violates the CHECK constraint. Also final.
  const unknownType = await recorder.record({
    checkoutIdentity: randomUUID().replace(/-/g, ''),
    orderId,
    eventType: 'NOT_A_REAL_EVENT' as never,
    policyVersion: 'proof-v1',
    payload: {},
    traceId: 'proof-trace',
  });
  check('an unknown event type is FINAL_FAILURE', unknownType, 'FINAL_FAILURE');

  // -- 5. Finishing the workflow must NOT overwrite the saga stage ---------
  // This is the false-completion regression. The previous complete() wrote
  // stage = 'COMPLETED', so an unpaid order at PAYMENT_READY was stored as a
  // completed checkout and its true position was destroyed.
  const claimIdentity = randomUUID().replace(/-/g, '');
  const claim = await idem.claim({
    identity: claimIdentity,
    principalKey: `g:${randomUUID()}`,
    fingerprint: randomUUID().replace(/-/g, ''),
  });
  check('the claim was acquired', claim.claimed, true);
  if (!claim.lease) throw new Error('claim reported acquired without a lease');

  await idem.advanceStage(claim.lease, 'PAYMENT_READY');
  const finished = await idem.finishOperation(claim.lease, orderId);
  check('finishOperation applied under the fence', finished, true);

  const [settled] = await db
    .select()
    .from(checkoutIdempotency)
    .where(eq(checkoutIdempotency.identity, claimIdentity));
  check('the saga stage is preserved as PAYMENT_READY', settled.stage, 'PAYMENT_READY');
  check('the stage is NOT overwritten with COMPLETED', settled.stage === 'COMPLETED', false);
  check('operation_state records that the workflow stopped', settled.operationState, 'TERMINAL');
  check('state still settles the idempotency key', settled.state, 'COMPLETED');

  // -- 6. A retryable failure must not erase the resume point --------------
  const failIdentity = randomUUID().replace(/-/g, '');
  const failClaim = await idem.claim({
    identity: failIdentity,
    principalKey: `g:${randomUUID()}`,
    fingerprint: randomUUID().replace(/-/g, ''),
  });
  if (!failClaim.lease) throw new Error('claim reported acquired without a lease');
  await idem.advanceStage(failClaim.lease, 'NOTIFICATION_QUEUED');
  await idem.fail(failClaim.lease, 'DEPENDENCY_UNAVAILABLE', true);

  const [failed] = await db
    .select()
    .from(checkoutIdempotency)
    .where(eq(checkoutIdempotency.identity, failIdentity));
  // Writing the failure into `stage` erased where the saga got to, so a resume
  // re-ran work that was already durably recorded.
  check('a failure preserves the resume point', failed.stage, 'NOTIFICATION_QUEUED');
  check('the failure is recorded on operation_state', failed.operationState, 'FAILED_RETRYABLE');

  // A takeover must resume from that stage rather than restarting.
  const retake = await idem.claim({
    identity: failIdentity,
    principalKey: failed.principalKey,
    fingerprint: failed.fingerprint,
  });
  check('a retryable failure is taken over', retake.claimed, true);
  check('the takeover reads the durable stage', retake.record.stage, 'NOTIFICATION_QUEUED');
  check('the takeover is running again', retake.record.operationState, 'IN_PROGRESS');

  // -- 7. Ownership lookup and forward-only payment progress ---------------
  // Payment start took an orderId from the request body and nothing else, so this
  // lookup is the whole authorization boundary.
  const payIdentity = randomUUID().replace(/-/g, '');
  const payOrderId = randomUUID();
  const payPrincipal = `g:${randomUUID()}`;
  const payClaim = await idem.claim({
    identity: payIdentity,
    principalKey: payPrincipal,
    fingerprint: randomUUID().replace(/-/g, ''),
  });
  if (!payClaim.lease) throw new Error('claim reported acquired without a lease');
  await idem.linkOrder(payClaim.lease, payOrderId);
  await idem.advanceStage(payClaim.lease, 'PAYMENT_READY');

  const owner = await idem.findByOrderId(payOrderId);
  check('findByOrderId resolves the owning checkout', owner?.identity, payIdentity);
  check('it reports the owning principal', owner?.principalKey, payPrincipal);
  check('findByOrderId returns null for an unknown order', await idem.findByOrderId(randomUUID()), null);

  const advanced = await idem.advancePaymentStage(payOrderId, 'PAYMENT_STARTED', ['PAYMENT_READY']);
  check('payment progress is recorded without a lease', advanced, true);

  // The guard is the WHERE clause: a duplicate has nothing left to leave, so it
  // updates nothing. This is what replaces a fence for a strictly forward move.
  const duplicate = await idem.advancePaymentStage(payOrderId, 'PAYMENT_STARTED', ['PAYMENT_READY']);
  check('a duplicate advance updates nothing', duplicate, false);

  const [afterPayment] = await db
    .select()
    .from(checkoutIdempotency)
    .where(eq(checkoutIdempotency.identity, payIdentity));
  check('the stage moved forward once', afterPayment.stage, 'PAYMENT_STARTED');
  // The workflow finished running long ago; payment progress must not claim
  // otherwise.
  check('operation_state is untouched by payment progress', afterPayment.operationState, 'IN_PROGRESS');

  // A backwards move must be refused: PAYMENT_READY is no longer a stage this
  // record may leave.
  const backwards = await idem.advancePaymentStage(payOrderId, 'PAYMENT_PENDING', ['PAYMENT_READY']);
  check('a stage it has already left cannot be re-entered', backwards, false);
  const forwards = await idem.advancePaymentStage(payOrderId, 'PAYMENT_PENDING', ['PAYMENT_STARTED']);
  check('the next real transition applies', forwards, true);

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
}

main()
  .then(async () => {
    await client.end({ timeout: 5 });
    process.exit(failures === 0 ? 0 : 1);
  })
  .catch(async (error) => {
    console.error('PROOF ABORTED:', error);
    await client.end({ timeout: 5 }).catch(() => undefined);
    process.exit(2);
  });
