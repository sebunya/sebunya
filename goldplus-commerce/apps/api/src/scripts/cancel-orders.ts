import '../config/env';
import { randomUUID } from 'node:crypto';
import { DrizzleOrderRepository } from '../infrastructure/db/repositories/DrizzleOrderRepository';
import { DrizzleInventoryRepository } from '../infrastructure/db/repositories/DrizzleInventoryRepository';
import { DrizzleAuditRepository } from '../infrastructure/db/repositories/DrizzleAuditRepository';
import { OrderTransitionService } from '../infrastructure/orders/OrderTransitionService';
import { ReleaseInventoryForOrderUseCase } from '../application/use-cases/inventory/InventoryUseCases';
import { CreateAuditLogUseCase } from '../application/use-cases/audit/CreateAuditLogUseCase';
import { endDbConnection } from '../infrastructure/db/client';

/**
 * Cancel one or more orders the canonical way — the same path the admin order
 * screen uses, run on the host without an admin HTTP session.
 *
 *   ORDER_NUMBERS=GP-...,GP-... ACTOR_USER_ID=<uuid> \
 *     npx tsx src/scripts/cancel-orders.ts
 *
 * Per order: transition status -> 'cancelled' through OrderTransitionService
 * (status update + ONE append-only order_event, in one transaction, with the
 * actor recorded), release any open inventory reservation (the order-status
 * path does not, only the fulfilment path did — so a stranded reservation is
 * released here explicitly), and write an admin audit row. Idempotent: an order
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

  const orderRepo = new DrizzleOrderRepository();
  const transitions = new OrderTransitionService();
  const releaseInventory = new ReleaseInventoryForOrderUseCase(new DrizzleInventoryRepository());
  const audit = new CreateAuditLogUseCase(new DrizzleAuditRepository());

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
      const released = await releaseInventory.execute(order.id);
      await audit.execute({
        actorId,
        action: 'ORDER_CANCELLED',
        entity: 'order',
        entityId: order.id,
        previousState: { status: from },
        newState: { status: 'cancelled', reason: 'test_order_cleanup', inventoryReleased: released.released, eventId: result.eventId },
      });
      console.log(`CANCELLED ${number} (${from} -> cancelled), inventory released=${released.released}, event=${result.eventId}, replay=${result.idempotentReplay}`);
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
