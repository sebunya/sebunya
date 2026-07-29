import { and, eq, lt, sql } from 'drizzle-orm';
import { db } from '../client';
import { checkoutIdempotency } from '../schema/commerce';
import {
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
export interface ClaimResult {
  claimed: boolean;
  record: IdempotencyRecord;
}

function toRecord(row: typeof checkoutIdempotency.$inferSelect): IdempotencyRecord {
  return {
    identity: row.identity,
    principalKey: row.principalKey,
    fingerprint: row.fingerprint,
    state: row.state as IdempotencyState,
    orderId: row.orderId,
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
  };
}

export class DrizzleCheckoutIdempotencyRepository {
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

    const inserted = await db
      .insert(checkoutIdempotency)
      .values({
        identity: args.identity,
        principalKey: args.principalKey,
        fingerprint: args.fingerprint,
        state: 'IN_PROGRESS',
        createdAt: now,
        updatedAt: now,
        expiresAt,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted.length === 1) return { claimed: true, record: toRecord(inserted[0]) };

    // Someone else holds it. Try to take over only if their claim is genuinely
    // dead: the lease lapsed, or they recorded a retryable failure. Matching the
    // fingerprint here means a conflicting request never steals a live claim —
    // it is refused by the caller's decision logic instead.
    const leaseCutoff = new Date(now.getTime() - IDEMPOTENCY_LEASE_SECONDS * 1000);
    const takenOver = await db
      .update(checkoutIdempotency)
      .set({ state: 'IN_PROGRESS', updatedAt: now, failureReason: null, expiresAt })
      .where(
        and(
          eq(checkoutIdempotency.identity, args.identity),
          eq(checkoutIdempotency.fingerprint, args.fingerprint),
          sql`(
            (${checkoutIdempotency.state} = 'IN_PROGRESS' AND ${checkoutIdempotency.updatedAt} < ${leaseCutoff})
            OR ${checkoutIdempotency.state} = 'FAILED_RETRYABLE'
          )`,
        ),
      )
      .returning();

    if (takenOver.length === 1) return { claimed: true, record: toRecord(takenOver[0]) };

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

  /** Marks the operation completed. Guarded so only the current claim may. */
  async complete(identity: string, orderId: string): Promise<boolean> {
    const updated = await db
      .update(checkoutIdempotency)
      .set({ state: 'COMPLETED', orderId, updatedAt: new Date(), failureReason: null })
      .where(
        and(
          eq(checkoutIdempotency.identity, identity),
          eq(checkoutIdempotency.state, 'IN_PROGRESS'),
        ),
      )
      .returning({ identity: checkoutIdempotency.identity });
    return updated.length === 1;
  }

  /**
   * Records a failure.
   *
   * `retryable` decides whether the customer may try the same key again. A
   * transient database fault must not permanently poison a key; a rejected
   * request (bad coupon, unavailable product) must not be retried into the same
   * failure forever.
   */
  async fail(identity: string, reason: string, retryable: boolean): Promise<boolean> {
    const updated = await db
      .update(checkoutIdempotency)
      .set({
        state: retryable ? 'FAILED_RETRYABLE' : 'FAILED_FINAL',
        // Truncated to the column width, and never the raw error object, which
        // can carry query text or customer data.
        failureReason: reason.slice(0, 200),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(checkoutIdempotency.identity, identity),
          eq(checkoutIdempotency.state, 'IN_PROGRESS'),
        ),
      )
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

  /** Expiry sweep. Never removes a COMPLETED record before its TTL. */
  async purgeExpired(now: Date = new Date()): Promise<number> {
    const removed = await db
      .delete(checkoutIdempotency)
      .where(lt(checkoutIdempotency.expiresAt, now))
      .returning({ identity: checkoutIdempotency.identity });
    return removed.length;
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
