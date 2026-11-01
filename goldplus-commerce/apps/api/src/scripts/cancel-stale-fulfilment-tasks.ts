import '../config/env';
import { Registry } from '../infrastructure/Registry';
import { endDbConnection } from '../infrastructure/db/client';

/**
 * Close fulfilment tasks left open on orders that are already terminal
 * (cancelled/completed). Found in the 2026-09-12 pre-live admin audit: the
 * order-cancel path releases stock but never touched the task, leaving NEW
 * tasks on cancelled orders. Goes through the REAL transition use case (state
 * machine + audit row), never a status overwrite. CANCELLED is the one move the
 * terminal-order guard still allows, by design.
 *
 *   ORDER_NUMBERS=GP-...,GP-... ACTOR_USER_ID=<uuid> npx tsx src/scripts/cancel-stale-fulfilment-tasks.ts
 */
async function main(): Promise<void> {
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the acting admin uuid.');
  const numbers = String(process.env.ORDER_NUMBERS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (numbers.length === 0) throw new Error('ORDER_NUMBERS is required.');
  const r = Registry.getInstance();
  for (const number of numbers) {
    const order = await r.orderRepo.findById(number);
    if (!order) { console.log(`SKIP ${number}: order not found`); continue; }
    const task = await r.fulfilmentRepo.findByOrderId(order.id);
    if (!task) { console.log(`SKIP ${number}: no fulfilment task`); continue; }
    if (task.status === 'CANCELLED' || task.status === 'DELIVERED') { console.log(`SKIP ${number}: task already ${task.status}`); continue; }
    const result = await r.transitionFulfilmentTaskUseCase.execute({
      taskId: task.id, toStatus: 'CANCELLED', actorId,
      notes: `Order is ${order.orderStatus}; task closed by stale-task cleanup (pre-live audit 2026-09-12).`,
    });
    console.log(result.ok ? `CANCELLED task ${task.id} for ${number} (${result.from} -> ${result.to})` : `FAILED ${number}: ${result.code} ${result.message}`);
  }
}
main().then(() => endDbConnection()).catch(async (e) => { console.error(e); await endDbConnection(); process.exit(1); });
