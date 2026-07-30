import { eq } from 'drizzle-orm';
import { db } from '../client';
import { checkoutSideEffects } from '../schema/commerce';
import { outboxEvents } from '../schema/system';
import {
  CheckoutSideEffectType,
  ICheckoutSideEffectRecorder,
  SideEffectOutcome,
} from '../../../application/ports/ICheckoutSideEffectRecorder';

/**
 * Durable, idempotent side-effect recording for checkout.
 *
 * WHAT WAS WRONG
 * Fulfilment task creation and the admin notification ran inside the checkout
 * request. A failure was passed to an observer and the checkout carried on to
 * report success. Reporting is evidence, not durability: if the process died after
 * the order committed, the work was simply gone — the operator had an order with
 * no fulfilment task and nothing anywhere recording that a task had ever been
 * owed. There was no way to answer "what does this order still need?" after a
 * crash, only to guess from the order's own columns.
 *
 * WHAT THIS DOES
 * The identity row and the outbox event are written in ONE transaction. Both
 * halves are load-bearing:
 *
 *   - identity without event  → the work is suppressed forever, because every
 *                               later attempt sees ALREADY_RECORDED and skips it
 *   - event without identity  → a retry cannot tell the work was queued and
 *                               enqueues it a second time
 *
 * The unique index on (checkout_identity, event_type) is the mechanism. A second
 * attempt conflicts rather than duplicating the business effect, and the conflict
 * is reported as ALREADY_RECORDED — a success, since the work is owed exactly
 * once and must not be redone.
 *
 * The outbox row is the durable intent. Performing the work is the consumer's job,
 * which is what makes it survive the request ending.
 */

/** Postgres unique-violation. A conflict here is an expected outcome, not a fault. */
const UNIQUE_VIOLATION = '23505';

/**
 * Faults that will not resolve on their own: the write is malformed or references
 * something that does not exist, so retrying it produces the same failure. Every
 * other database fault is treated as transient, which is the safe default —
 * retrying costs an attempt, whereas giving up on a real outage abandons work the
 * customer's order depends on.
 */
const FINAL_SQLSTATES = new Set([
  '23502', // not_null_violation
  '23503', // foreign_key_violation
  '23514', // check_violation
  '22001', // string_data_right_truncation
  '22P02', // invalid_text_representation
  '42703', // undefined_column
  '42P01', // undefined_table
]);

function sqlState(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : null;
}

export class DrizzleCheckoutSideEffectRecorder implements ICheckoutSideEffectRecorder {
  async record(args: {
    checkoutIdentity: string;
    orderId: string;
    eventType: CheckoutSideEffectType;
    policyVersion: string;
    payload: Record<string, unknown>;
    traceId: string;
  }): Promise<SideEffectOutcome> {
    try {
      const outcome = await db.transaction(async (tx) => {
        // The identity is claimed FIRST. If it conflicts, the transaction ends
        // here and no second outbox event is created — the conflict is the whole
        // idempotency guarantee, so it must be reached before any work is
        // enqueued rather than cleaned up afterwards.
        const claimed = await tx
          .insert(checkoutSideEffects)
          .values({
            checkoutIdentity: args.checkoutIdentity,
            orderId: args.orderId,
            eventType: args.eventType,
            policyVersion: args.policyVersion,
            traceId: args.traceId.slice(0, 128),
          })
          .onConflictDoNothing({
            target: [checkoutSideEffects.checkoutIdentity, checkoutSideEffects.eventType],
          })
          .returning({ id: checkoutSideEffects.id });

        if (claimed.length === 0) return 'ALREADY_RECORDED' as const;

        const [event] = await tx
          .insert(outboxEvents)
          .values({
            eventType: args.eventType,
            payload: args.payload,
            // Scoped to this checkout, not just the order: the same order must not
            // be able to acquire a second event of the same type through a
            // different code path.
            idempotencyKey: `checkout:${args.checkoutIdentity}:${args.eventType}`,
            relatedEntity: 'order',
            relatedEntityId: args.orderId,
            // Commerce work, not an outbound message. These flags exist to keep
            // provider delivery and customer communications gated; a fulfilment
            // task carries no outbound send, so it must not be marked dry-run —
            // that would make it look suppressed to the governance surface.
            dryRunOnly: false,
            previewOnly: false,
            noSendGuarantee: false,
            status: 'pending',
          })
          .returning({ id: outboxEvents.id });

        // Link source to delivery so the two can be reconciled. Same
        // transaction, so a row can never name an event that was rolled back.
        await tx
          .update(checkoutSideEffects)
          .set({ outboxEventId: event.id })
          .where(eq(checkoutSideEffects.id, claimed[0].id));

        return 'DURABLY_RECORDED' as const;
      });

      return outcome;
    } catch (error) {
      // A unique violation raised from the outbox idempotency key means a prior
      // attempt got as far as the event. Treated as already recorded: the work is
      // queued, and the caller must not enqueue it again.
      if (sqlState(error) === UNIQUE_VIOLATION) return 'ALREADY_RECORDED';
      return FINAL_SQLSTATES.has(sqlState(error) ?? '') ? 'FINAL_FAILURE' : 'RETRYABLE_FAILURE';
    }
  }

  async recordedTypes(checkoutIdentity: string): Promise<CheckoutSideEffectType[]> {
    const rows = await db
      .select({ eventType: checkoutSideEffects.eventType })
      .from(checkoutSideEffects)
      .where(eq(checkoutSideEffects.checkoutIdentity, checkoutIdentity));
    return rows.map((row) => row.eventType as CheckoutSideEffectType);
  }
}
