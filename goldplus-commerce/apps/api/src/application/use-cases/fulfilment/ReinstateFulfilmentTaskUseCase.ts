import { FulfilmentTask } from '../../../domain/fulfilment/FulfilmentTask';
import { isTerminalOrderStatus } from '../../../domain/commerce/OrderStateMachine';
import { OrderStatus } from '../../../domain/commerce/Order';
import { IFulfilmentRepository } from '../../ports/IFulfilmentRepository';
import { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';

export type ReinstateFulfilmentResult =
  | { ok: true; taskId: string; orderId: string }
  | { ok: false; code: 'NOT_FOUND' | 'NOT_CANCELLED' | 'ORDER_CLOSED'; message: string };

/**
 * Return a CANCELLED fulfilment task to the work queue.
 *
 * The recovery half of a one-way door: a task may be cancelled from any active
 * state, cancellation is terminal, and the create-on-order-placed path is
 * keyed on a unique order_id and short-circuits on ANY existing row. So an
 * order still open to the customer whose task was cancelled — by mistake, or
 * to clear a queue — became permanently unpickable with no code path back.
 *
 * The guard that matters is the parent ORDER: reinstating work for an order
 * that is genuinely finished or cancelled would resurrect work nobody wants,
 * so a terminal order is refused. Everything else is an operator decision and
 * is audited as one.
 */
export class ReinstateFulfilmentTaskUseCase {
  constructor(
    private readonly repo: IFulfilmentRepository,
    private readonly audit: IAuditRepository,
    private readonly orders: { findById(id: string): Promise<{ orderStatus: OrderStatus } | null> },
  ) {}

  async execute(input: { taskId: string; actorId: string; reason?: string | null }): Promise<ReinstateFulfilmentResult> {
    const snapshot = await this.repo.findById(input.taskId);
    if (!snapshot) {
      return { ok: false, code: 'NOT_FOUND', message: 'Fulfilment task not found.' };
    }
    if (snapshot.status !== 'CANCELLED') {
      return {
        ok: false,
        code: 'NOT_CANCELLED',
        message: `Only a cancelled task can be reinstated; this one is ${snapshot.status}.`,
      };
    }

    const order = await this.orders.findById(snapshot.orderId);
    if (!order) {
      return { ok: false, code: 'NOT_FOUND', message: 'The order this task belongs to no longer exists.' };
    }
    if (isTerminalOrderStatus(order.orderStatus)) {
      return {
        ok: false,
        code: 'ORDER_CLOSED',
        message: `Order is ${order.orderStatus} — reinstating its fulfilment task would create work for a closed order.`,
      };
    }

    const task = FulfilmentTask.rehydrate(snapshot);
    task.reinstate();
    // Compare-and-swap on the stored status: if another operator reinstated
    // this task between our read and our write, we are the loser and say so —
    // one reinstatement, one audit entry, however many people pressed.
    const applied = await this.repo.updateWhereStatus(task, 'CANCELLED');
    if (!applied) {
      return { ok: false, code: 'NOT_CANCELLED', message: 'This task was reinstated a moment ago by someone else.' };
    }

    await new CreateAuditLogUseCase(this.audit).execute({
      actorId: input.actorId,
      action: 'FULFILMENT_TASK_REINSTATED',
      entity: 'fulfilment_task',
      entityId: task.id,
      previousState: { status: 'CANCELLED', assignedTo: snapshot.assignedTo ?? null },
      newState: { status: 'NEW', assignedTo: null, orderStatus: order.orderStatus, reason: input.reason ?? null },
    });

    return { ok: true, taskId: task.id, orderId: snapshot.orderId };
  }
}
