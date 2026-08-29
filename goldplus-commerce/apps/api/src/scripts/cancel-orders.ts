import '../config/env';
import { Registry } from '../infrastructure/Registry';
import { endDbConnection } from '../infrastructure/db/client';
import { CreateAuditLogUseCase } from '../application/use-cases/audit/CreateAuditLogUseCase';

/**
 * Cancel named orders through the REAL state machine (operator-delegated).
 *
 * Drives orderTransitionService exactly as the admin console's
 * POST /admin/orders/:id/transition does: the same OrderStateMachine, the same
 * refusal on an illegal move, the same ORDER_TRANSITIONED audit row naming the
 * actor. Deliberately NOT a SQL update — that would move the status while
 * skipping the machine, the side effects and the audit trail.
 *
 * Idempotent: an order already in the target status is reported and skipped.
 *
 * Usage:
 *   ACTOR_USER_ID=<admin uuid> ORDERS=GP-...,GP-... REASON="..." \
 *     npx tsx src/scripts/cancel-orders.ts
 */
async function main(): Promise<void> {
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the acting admin uuid.');

  const numbers = String(process.env.ORDERS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (numbers.length === 0) throw new Error('ORDERS must list at least one order number.');

  const reason = String(process.env.REASON ?? '').trim();
  if (!reason) throw new Error('REASON is required, exactly as the admin route requires one.');

  const registry = Registry.getInstance();
  const audit = new CreateAuditLogUseCase(registry.auditRepo);

  for (const orderNumber of numbers) {
    const order = await registry.orderRepo.findById(orderNumber);
    if (!order) {
      console.log(`[cancel-orders] ${orderNumber}: NOT FOUND, skipped`);
      continue;
    }
    if (order.orderStatus === 'cancelled') {
      console.log(`[cancel-orders] ${orderNumber}: already cancelled, skipped`);
      continue;
    }
    // Money must not be stranded: a paid order needs a refund decision, which is
    // a person's call, not this script's.
    if (order.paymentStatus === 'paid') {
      console.log(`[cancel-orders] ${orderNumber}: PAID — refusing. Refund it through the admin console first.`);
      continue;
    }

    const result = await registry.orderTransitionService.transition(order.id, 'cancelled', {
      actorId,
      actorType: 'administrator',
      // Same source the admin console records: this drives the identical path.
      source: 'admin_api',
      reasonCode: 'ADMIN_ACTION',
      note: reason,
    });

    await audit.execute({
      actorId,
      action: 'ORDER_TRANSITIONED',
      entity: 'order',
      entityId: order.id,
      previousState: { status: result.fromStatus },
      newState: { status: result.toStatus, reason, idempotentReplay: result.idempotentReplay },
    });

    console.log(
      `[cancel-orders] ${orderNumber}: ${result.fromStatus} -> ${result.toStatus}` +
        (result.idempotentReplay ? ' (idempotent replay)' : ''),
    );
  }
}

main()
  .then(() => endDbConnection())
  .catch(async (err) => {
    console.error('[cancel-orders] failed', err);
    await endDbConnection();
    process.exitCode = 1;
  });
