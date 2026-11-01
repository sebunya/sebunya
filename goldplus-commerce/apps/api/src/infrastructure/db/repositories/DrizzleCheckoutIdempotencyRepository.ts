import { and, eq, inArray, lt, notInArray, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { db } from '../client';
import { checkoutIdempotency } from '../schema/commerce';
import {
  ClaimResult,
  ICheckoutIdempotencyRepository,
  LeaseToken,
  CheckoutSagaStage,
} from '../../../application/ports/ICheckoutIdempotencyRepository';
import {
  CheckoutOperationState,
  IdempotencyRecord,
  IdempotencyState,
  IDEMPOTENCY_LEASE_SECONDS,
  IDEMPOTENCY_RECORD_TTL_SECONDS,
} from '../../../domain/commerce/CheckoutPrincipal';

/**
 * Atomic idempotency claim.
 *
 * The previous mechanism was a read-then-write against the orders table: look up
 * the key, and if nothing came back, do the commerce work. Two concurrent
 * submissions both read nothing and both proceeded — pricing, capacity
 * reservation, order creation — and only the unique index on client_order_key
 * stopped the second from landing, after all the work was already done.
 *
 * `INSERT ... ON CONFLICT DO NOTHING` moves the decision to a single statement
 * the database arbitrates. Exactly one caller inserts; every other caller reads
 * back the existing row and is told what to do about it.
 */
export const LEASE_DURATION_SECONDS = 120;

/**
 * Stages that hold unresolved commerce, and therefore block deletion.
 *
 * Matches the `checkout_idempotency_unresolved_idx` partial index in migration
 * 0059 exactly. A stage that appears in one and not the other would either scan
 * the whole table or, worse, let the sweep delete something the index was created
 * to protect — so the two lists must be changed together.
 */
export const UNRESOLVED_STAGES: readonly CheckoutSagaStage[] = [
  'ORDER_CREATED',
  'INVENTORY_RESERVED',
  'BLOCKED_STOCK',
  'FULFILMENT_QUEUED',
  'NOTIFICATION_QUEUED',
  'PAYMENT_READY',
  'PAYMENT_STARTED',
  'PAYMENT_PENDING',
  'PAYMENT_REVIEW',
];

function newClaimToken(): string {
  return randomBytes(24).toString('hex');
}

function toRecord(row: typeof checkoutIdempotency.$inferSelect): IdempotencyRecord {
  return {
    identity: row.identity,
    principalKey: row.principalKey,
    fingerprint: row.fingerprint,
    state: row.state as IdempotencyState,
    operationState: row.operationState as CheckoutOperationState,
    stage: row.stage,
    orderId: row.orderId,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
  };
}

export class DrizzleCheckoutIdempotencyRepository implements ICheckoutIdempotencyRepository {
  /**
   * Claims the identity, or returns the row that already holds it.
   *
   * A lapsed IN_PROGRESS claim and a FAILED_RETRYABLE row are both taken over by
   * the same conditional UPDATE, so a process that died mid-checkout does not
   * wedge the customer's key forever. The UPDATE's WHERE clause carries the lease
   * condition, so two requests racing to take over a stale claim cannot both win.
   */
  async claim(args: {
    identity: string;
    principalKey: string;
    fingerprint: string;
    now?: Date;
  }): Promise<ClaimResult> {
    const now = args.now ?? new Date();
    const expiresAt = new Date(now.getTime() + IDEMPOTENCY_RECORD_TTL_SECONDS * 1000);

    const claimToken = newClaimToken();
    const leaseExpiresAt = new Date(now.getTime() + LEASE_DURATION_SECONDS * 1000);

    const inserted = await db
      .insert(checkoutIdempotency)
      .values({
        identity: args.identity,
        principalKey: args.principalKey,
        fingerprint: args.fingerprint,
        state: 'IN_PROGRESS',
        stage: 'CLAIMED',
        claimToken,
        fencingNumber: 1,
        attemptNumber: 1,
        leaseExpiresAt,
        lastHeartbeatAt: now,
        createdAt: now,
        updatedAt: now,
        expiresAt,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted.length === 1) {
      return {
        claimed: true,
        record: toRecord(inserted[0]),
        lease: { identity: args.identity, claimToken, fencingNumber: 1 },
      };
    }

    // Someone else holds it. Try to take over only if their claim is genuinely
    // dead: the lease lapsed, or they recorded a retryable failure. Matching the
    // fingerprint here means a conflicting request never steals a live claim —
    // it is refused by the caller's decision logic instead.
    // The lease extension is part of THIS statement, not a follow-up. Verified
    // against a real PostgreSQL: without it the row still satisfies
    // `lease_expires_at < now()` after the first takeover commits, so every
    // subsequent contender also takes over and the fence cascades — six
    // concurrent requests produced six owners.
    const takenOver = await db
      .update(checkoutIdempotency)
      .set({
        state: 'IN_PROGRESS',
        // The workflow is running again. `stage` is left alone: it is exactly the
        // durable evidence this takeover resumes from.
        operationState: 'IN_PROGRESS',
        claimToken,
        fencingNumber: sql`${checkoutIdempotency.fencingNumber} + 1`,
        attemptNumber: sql`${checkoutIdempotency.attemptNumber} + 1`,
        leaseExpiresAt,
        lastHeartbeatAt: now,
        updatedAt: now,
        failureReason: null,
        expiresAt,
      })
      .where(
        and(
          eq(checkoutIdempotency.identity, args.identity),
          eq(checkoutIdempotency.fingerprint, args.fingerprint),
          sql`(
            (${checkoutIdempotency.state} = 'IN_PROGRESS'
              AND (${checkoutIdempotency.leaseExpiresAt} IS NULL OR ${checkoutIdempotency.leaseExpiresAt} < ${now}))
            OR ${checkoutIdempotency.state} = 'FAILED_RETRYABLE'
          )`,
        ),
      )
      .returning();

    if (takenOver.length === 1) {
      return {
        claimed: true,
        record: toRecord(takenOver[0]),
        lease: {
          identity: args.identity,
          claimToken,
          fencingNumber: takenOver[0].fencingNumber,
        },
      };
    }

    const [existing] = await db
      .select()
      .from(checkoutIdempotency)
      .where(eq(checkoutIdempotency.identity, args.identity));

    // The row vanished between the conflict and this read (expiry sweep). Treat
    // it as unclaimed rather than inventing a state.
    if (!existing) {
      return this.claim({ ...args, now });
    }
    return { claimed: false, record: toRecord(existing) };
  }

  /**
   * Every mutation must present the lease. Identity alone is not ownership: after
   * a takeover the row is IN_PROGRESS again, so a worker returning late from a
   * slow call matched a state-only predicate and could overwrite its successor.
   * Proven against real PostgreSQL: the stale worker now updates zero rows.
   */
  private fenced(lease: LeaseToken) {
    return and(
      eq(checkoutIdempotency.identity, lease.identity),
      eq(checkoutIdempotency.claimToken, lease.claimToken),
      eq(checkoutIdempotency.fencingNumber, lease.fencingNumber),
      eq(checkoutIdempotency.state, 'IN_PROGRESS'),
    );
  }

  /**
   * Links the order to the claim the moment the order exists.
   *
   * The route used to save the order and then complete the record in a separate
   * statement. A crash in that window left a committed order and an IN_PROGRESS
   * record with order_id NULL, so a later takeover re-priced, re-reserved and
   * re-created — duplicating the order the customer already had. Recording the
   * order at ORDER_CREATED means a retry resumes instead of restarting.
   */
  async linkOrder(lease: LeaseToken, orderId: string): Promise<boolean> {
    const updated = await db
      .update(checkoutIdempotency)
      .set({ orderId, stage: 'ORDER_CREATED', updatedAt: new Date() })
      .where(this.fenced(lease))
      .returning({ identity: checkoutIdempotency.identity });
    return updated.length === 1;
  }

  /**
   * The checkout that produced this order, for object-level authorization.
   *
   * `order_id` is uniquely indexed (migration 0057), so this is at most one row.
   */
  async findByOrderId(orderId: string): Promise<IdempotencyRecord | null> {
    // order_id is uuid; a non-uuid (an order number) cannot match and used to raise 22P02.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId)) return null;
    const rows = await db
      .select()
      .from(checkoutIdempotency)
      .where(eq(checkoutIdempotency.orderId, orderId))
      .limit(1);
    return rows.length === 1 ? toRecord(rows[0]) : null;
  }

  /**
   * Records payment progress without a lease, by moving forward only.
   *
   * The checkout lease belongs to the request that created the order and is long
   * expired by the time a customer returns from a bank page. Rather than keep a
   * lease alive across a human being's actions — or give up on recording payment
   * progress at all — the transition names the stages it is allowed to leave. A
   * late duplicate matches nothing and updates nothing, which is the same
   * protection a fence gives for a strictly forward move.
   *
   * `operation_state` is deliberately untouched: this is saga progress, not a
   * statement about a workflow that finished running long ago.
   */
  async advancePaymentStage(
    orderId: string,
    stage: CheckoutSagaStage,
    from: readonly CheckoutSagaStage[],
  ): Promise<boolean> {
    if (from.length === 0) return false;
    const updated = await db
      .update(checkoutIdempotency)
      .set({ stage, updatedAt: new Date() })
      .where(
        and(
          eq(checkoutIdempotency.orderId, orderId),
          inArray(checkoutIdempotency.stage, [...from]),
        ),
      )
      .returning({ identity: checkoutIdempotency.identity });
    return updated.length === 1;
  }

  /** Advances the durable saga stage under the active fence. */
  async advanceStage(
    lease: LeaseToken,
    stage: CheckoutSagaStage,
  ): Promise<boolean> {
    const updated = await db
      .update(checkoutIdempotency)
      .set({ stage, updatedAt: new Date() })
      .where(this.fenced(lease))
      .returning({ identity: checkoutIdempotency.identity });
    return updated.length === 1;
  }

  /**
   * Renews the lease while legitimate work continues, so a slow-but-alive
   * request is not evicted mid-checkout by a contender.
   */
  async heartbeat(lease: LeaseToken, now: Date = new Date()): Promise<boolean> {
    const updated = await db
      .update(checkoutIdempotency)
      .set({
        lastHeartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + LEASE_DURATION_SECONDS * 1000),
        updatedAt: now,
      })
      .where(this.fenced(lease))
      .returning({ identity: checkoutIdempotency.identity });
    return updated.length === 1;
  }

  /**
   * Marks the WORKFLOW as no longer running. Requires the active lease.
   *
   * `stage` is deliberately untouched. The previous version also wrote
   * stage = 'COMPLETED', which destroyed the saga position: an order that had only
   * reached PAYMENT_READY was stored as a completed checkout, so nothing reading
   * progress could tell an unpaid order from a confirmed one, and a resume could
   * not tell which side effects were still owed.
   *
   * `state` remains COMPLETED because it drives the idempotency decision machine —
   * "this key is settled, replay its order" — while `operation_state` carries the
   * outcome. TERMINAL means the workflow stopped running; it does not mean paid.
   */
  async finishOperation(lease: LeaseToken, orderId: string): Promise<boolean> {
    const updated = await db
      .update(checkoutIdempotency)
      .set({
        state: 'COMPLETED',
        operationState: 'TERMINAL',
        orderId,
        updatedAt: new Date(),
        failureReason: null,
        leaseExpiresAt: null,
      })
      .where(this.fenced(lease))
      .returning({ identity: checkoutIdempotency.identity });
    return updated.length === 1;
  }

  /**
   * Records a failure. Requires the active lease.
   *
   * `retryable` decides whether the customer may try the same key again. A
   * transient database fault must not permanently poison a key; a rejected
   * request (bad coupon, unavailable product) must not be retried into the same
   * failure forever.
   */
  async fail(lease: LeaseToken, reason: string, retryable: boolean): Promise<boolean> {
    const updated = await db
      .update(checkoutIdempotency)
      .set({
        state: retryable ? 'FAILED_RETRYABLE' : 'FAILED_FINAL',
        operationState: retryable ? 'FAILED_RETRYABLE' : 'FAILED_FINAL',
        // `stage` is NOT overwritten. Writing the failure into the stage column
        // erased where the saga had got to, so a retryable failure at
        // NOTIFICATION_QUEUED resumed from nothing and re-ran work that was
        // already durably recorded.
        // Truncated to the column width, and never the raw error object, which
        // can carry query text or customer data.
        failureReason: reason.slice(0, 200),
        updatedAt: new Date(),
        leaseExpiresAt: null,
      })
      .where(this.fenced(lease))
      .returning({ identity: checkoutIdempotency.identity });
    return updated.length === 1;
  }

  async find(identity: string): Promise<IdempotencyRecord | null> {
    const [row] = await db
      .select()
      .from(checkoutIdempotency)
      .where(eq(checkoutIdempotency.identity, identity));
    return row ? toRecord(row) : null;
  }

  /**
   * State-aware expiry sweep.
   *
   * WHAT WAS WRONG
   * The sweep deleted every row whose `expires_at` had passed, consulting nothing
   * else. A checkout that reached PAYMENT_STARTED and sat there — a customer who
   * opened the bank page and took longer than the 24-hour TTV, or a provider that
   * had not yet confirmed — was deleted along with everything it was the only
   * record of:
   *
   *   - WHO OWNS THE ORDER. Payment start authorizes against this row. Deleting it
   *     does not merely lose history; it makes the order unpayable by its owner
   *     while the provider transaction is still live.
   *   - WHICH SIDE EFFECTS ARE OWED, and the identity a retry would collapse onto.
   *   - The idempotency guarantee itself: with the row gone, a resubmission with
   *     the same key creates a SECOND order.
   *
   * An expiry policy is about reclaiming space, and it must never be the mechanism
   * that discards live commerce. Retention is therefore a function of state, not of
   * a timestamp: a row is removable only when its saga holds nothing unresolved.
   *
   * The unresolved stages match migration 0059's partial index, so this predicate
   * is index-backed rather than a full scan.
   */
  async purgeExpired(now: Date = new Date()): Promise<{
    removed: number;
    retainedUnresolved: number;
  }> {
    const removed = await db
      .delete(checkoutIdempotency)
      .where(
        and(
          lt(checkoutIdempotency.expiresAt, now),
          notInArray(checkoutIdempotency.stage, [...UNRESOLVED_STAGES]),
        ),
      )
      .returning({ identity: checkoutIdempotency.identity });

    // Reported rather than silently skipped: a growing number here is an
    // operational fact — checkouts stuck mid-saga — and an operator who cannot see
    // it will read the sweep's falling delete count as everything being fine.
    const [retained] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(checkoutIdempotency)
      .where(
        and(
          lt(checkoutIdempotency.expiresAt, now),
          inArray(checkoutIdempotency.stage, [...UNRESOLVED_STAGES]),
        ),
      );

    return { removed: removed.length, retainedUnresolved: retained?.n ?? 0 };
  }

  /** Operator signal: claims that never completed. */
  async countStuckClaims(now: Date = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - IDEMPOTENCY_LEASE_SECONDS * 1000);
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(checkoutIdempotency)
      .where(
        and(eq(checkoutIdempotency.state, 'IN_PROGRESS'), lt(checkoutIdempotency.updatedAt, cutoff)),
      );
    return row?.n ?? 0;
  }
}
