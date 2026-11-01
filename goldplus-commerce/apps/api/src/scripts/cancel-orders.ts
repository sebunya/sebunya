import '../config/env';
import { randomUUID } from 'node:crypto';
import { Registry } from '../infrastructure/Registry';
import { GOODS_LEFT_STATUSES } from '../application/use-cases/inventory/ApplyFulfilmentStockEffectUseCase';
import { CreateAuditLogUseCase } from '../application/use-cases/audit/CreateAuditLogUseCase';
import { endDbConnection } from '../infrastructure/db/client';

/**
 * Cancel one or more orders the canonical way — the same path the admin order
 * screen uses, run on the host without an admin HTTP session.
 *
 *   ORDER_NUMBERS=GP-...,GP-... ACTOR_USER_ID=<uuid> \
 *     npx tsx src/scripts/cancel-orders.ts
 *
 * Per order: transition status -> 'cancelled' through the Registry's
 * OrderTransitionService (status update + ONE append-only order_event, in one
 * transaction, with the actor recorded). Using the Registry's instance runs its
 * subscribers exactly as the admin screen does: stock, gift-card/store-credit
 * and points holds are released, the customer is told, ad conversions are
 * withdrawn. A bare, unsubscribed service instance ran none of them. An order
 * whose goods have left the shop (dispatched) is skipped: its stock must not go
 * back on sale. Then an admin audit row is written. Idempotent: an order
 * already cancelled is skipped; the transition's idempotencyKey makes a re-run
 * a no-op rather than a second event.
 *
 * Built for the two 2026-09-12 test orders (the failed GP-202609-9BB3479C and
 * the pay-by-reference verification GP-202609-5C32F237), but parameterised so
 * it is not a one-shot.
 */
const TERMINAL = new Set(['cancelled', 'completed', 'delivered']);

async function main(): Promise<void> {
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the acting admin uuid.');
  const numbers = String(process.env.ORDER_NUMBERS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (numbers.length === 0) throw new Error('ORDER_NUMBERS must be a comma-separated list of order numbers.');

  const registry = Registry.getInstance();
  const orderRepo = registry.orderRepo;
  const transitions = registry.orderTransitionService;
  const audit = new CreateAuditLogUseCase(registry.auditRepo);

  for (const number of numbers) {
    const order = await orderRepo.findById(number); // findById accepts an order number too
    if (!order) {
      console.log(`SKIP ${number}: not found`);
      continue;
    }
    if (TERMINAL.has(order.orderStatus)) {
      console.log(`SKIP ${number}: already ${order.orderStatus}`);
      continue;
    }
    if (GOODS_LEFT_STATUSES.has(order.orderStatus)) {
      console.log(`SKIP ${number}: ${order.orderStatus} — the goods have left the shop; record the delivery outcome or a return instead`);
      continue;
    }
    const from = order.orderStatus;
    try {
      const result = await transitions.transition(order.id, 'cancelled', {
        actorId,
        actorType: 'administrator',
        source: 'admin_api',
        reasonCode: 'test_order_cleanup',
        note: 'Cancelled by owner request — test order cleanup (2026-09-12).',
        idempotencyKey: `cancel:${order.id}`,
      });
      await audit.execute({
        actorId,
        action: 'ORDER_CANCELLED',
        entity: 'order',
        entityId: order.id,
        previousState: { status: from },
        newState: { status: 'cancelled', reason: 'test_order_cleanup', holdsReleasedBy: 'order_transition_subscribers', eventId: result.eventId },
      });
      console.log(`CANCELLED ${number} (${from} -> cancelled), holds released by the transition, event=${result.eventId}, replay=${result.idempotentReplay}`);
    } catch (e) {
      console.log(`FAILED ${number} (${from} -> cancelled): ${(e as Error).message}`);
    }
  }
  void randomUUID; // reserved for future correlation ids
}

main()
  .then(() => endDbConnection())
  .catch(async (e) => {
    console.error(e);
    await endDbConnection();
    process.exit(1);
  });
