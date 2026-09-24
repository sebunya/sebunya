import { FulfilmentTask, FulfilmentStatus, FULFILMENT_STATUSES } from '../../../domain/fulfilment/FulfilmentTask';
import { IFulfilmentRepository } from '../../ports/IFulfilmentRepository';
import { IAuditRepository } from '../../ports/IAuditRepository';
import { IOrderTransitionPort } from '../../ports/IOrderTransitionPort';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';
import type { OrderStatus } from '../../../domain/commerce/Order';
import { isTerminalOrderStatus } from '../../../domain/commerce/OrderStateMachine';

export type TransitionFulfilmentResult =
  | { ok: true; taskId: string; orderId: string; from: FulfilmentStatus; to: FulfilmentStatus }
  | { ok: false; code: 'NOT_FOUND' | 'INVALID_STATUS' | 'INVALID_TRANSITION'; message: string };

/**
 * Authorised admin transition of a fulfilment task through its lifecycle.
 * Validates the target status, enforces the pure transition rules, persists the
 * change, and writes an audit-log timeline entry (entity = fulfilment_task).
 */
export class TransitionFulfilmentTaskUseCase {
  constructor(
    private readonly repo: IFulfilmentRepository,
    private readonly audit: IAuditRepository,
    /**
     * Location module stage 2: dispatching the task (OUT_FOR_DELIVERY) mirrors
     * the ORDER into `dispatched` through the canonical ledgered path. Optional
     * so existing callers/tests remain valid; refusals (legacy orders not in
     * `processing`) are non-fatal — the task still moves.
     */
    private readonly orderTransitions?: IOrderTransitionPort,
    /**
     * The records the dedicated paths create. The generic transition used to
     * accept OUT_FOR_DELIVERY with no dispatch record (so no cash-on-delivery
     * acknowledgement and no PAYMENT_NOT_CLEARED refusal) and READY_FOR_DISPATCH
     * with the packing never completed. Optional so existing callers and tests
     * construct unchanged; when wired, both are refused (and DELIVERED without
     * a delivery record, below).
     */
    private readonly guards?: {
      dispatches?: { getByTask(taskId: string): Promise<unknown | null> };
      packingSessions?: { getByTask(taskId: string): Promise<{ status: string } | null> };
      /**
       * Delivery attempts (fulfilment_deliveries). DELIVERED belongs to
       * RecordDeliveryUseCase, which writes the attempt AND moves the order to
       * `delivered`. The generic path used to accept DELIVERED with neither, so
       * the order sat at `dispatched` forever: no loyalty vesting, no delivery
       * calibration, "On its way" on the customer's tracking page — and the
       * task, now terminal, could no longer take the proper record.
       */
      deliveries?: { listByTask(taskId: string): Promise<ReadonlyArray<{ deliveredAt: Date | null }>> };
    },
    /**
     * The task's ORDER. A cancelled/completed/refunded order must never be
     * worked: the fulfilment queue already hides such tasks, but a task reached
     * directly by id could still be acknowledged, picked and dispatched — the
     * order mirror on dispatch is deliberately non-fatal, so goods would leave
     * for an order that is no longer live. Forward moves are refused when the
     * order is terminal; CANCELLED stays allowed so a stale task can be closed.
     * Optional so existing callers and tests construct unchanged (unwired =
     * no order check, the previous behaviour).
     */
    private readonly orders?: { findById(id: string): Promise<{ orderStatus: OrderStatus } | null> },
  ) {}

  async execute(input: {
    taskId: string;
    toStatus: string;
    actorId: string;
    assignedTo?: string | null;
    notes?: string | null;
  }): Promise<TransitionFulfilmentResult> {
    const to = input.toStatus as FulfilmentStatus;
    if (!FULFILMENT_STATUSES.includes(to)) {
      return { ok: false, code: 'INVALID_STATUS', message: `Unknown fulfilment status "${input.toStatus}".` };
    }

    const snapshot = await this.repo.findById(input.taskId);
    if (!snapshot) {
      return { ok: false, code: 'NOT_FOUND', message: 'Fulfilment task not found.' };
    }

    const from = snapshot.status;

    if (this.orders) {
      const order = await this.orders.findById(snapshot.orderId);
      // Fail closed: a status the state machine does not know is not a live
      // order either, and must not become a 500 on the operator's screen.
      const orderIsClosed = (status: OrderStatus): boolean => { try { return isTerminalOrderStatus(status); } catch { return true; } };
      if (to !== 'CANCELLED' && order && orderIsClosed(order.orderStatus)) {
        return {
          ok: false,
          code: 'INVALID_TRANSITION',
          message: `Order is ${order.orderStatus} — its fulfilment task cannot be moved to ${to}. Cancel the task instead.`,
        };
      }
      // The mirror image: cancelling the TASK of a LIVE order. The route then
      // puts the order's stock back on sale and emails "Order cancelled", while
      // the order itself stays open — paid, "being prepared" to the customer.
      // The order is the authority; cancel it first, then close its task.
      if (to === 'CANCELLED' && order && !orderIsClosed(order.orderStatus)) {
        return {
          ok: false,
          code: 'INVALID_TRANSITION',
          message: `Order is still ${order.orderStatus}. Cancel the order first — cancelling only its fulfilment task would put the stock back on sale while the customer's order stays open.`,
        };
      }
    }

    if (to === 'OUT_FOR_DELIVERY' && this.guards?.dispatches) {
      const dispatch = await this.guards.dispatches.getByTask(input.taskId);
      if (!dispatch) {
        return { ok: false, code: 'INVALID_TRANSITION', message: 'Record the dispatch first. Marking a task out for delivery without a dispatch record skips the payment check.' };
      }
    }
    if (to === 'DELIVERED' && this.guards?.deliveries) {
      const attempts = await this.guards.deliveries.listByTask(input.taskId);
      if (!attempts.some((a) => a.deliveredAt !== null)) {
        return { ok: false, code: 'INVALID_TRANSITION', message: 'Record the delivery first (the task\'s Delivery page). Marking a task delivered without a delivery record never completes the order.' };
      }
    }
    if (to === 'READY_FOR_DISPATCH' && this.guards?.packingSessions) {
      const session = await this.guards.packingSessions.getByTask(input.taskId);
      if (!session || (session.status !== 'COMPLETED' && session.status !== 'PARTIAL')) {
        return { ok: false, code: 'INVALID_TRANSITION', message: 'Finish packing first. A task is ready for dispatch only once its packing session is completed.' };
      }
    }

    const task = FulfilmentTask.rehydrate(snapshot);
    try {
      task.transition(to, { assignedTo: input.assignedTo, notes: input.notes });
    } catch {
      return {
        ok: false,
        code: 'INVALID_TRANSITION',
        message: `Cannot move fulfilment task from ${from} to ${to}.`,
      };
    }

    await this.repo.update(task);

    let orderMirror: 'dispatched' | 'delivered' | 'skipped' | 'not_wired' = 'not_wired';
    if (this.orderTransitions && to === 'DELIVERED') {
      // Reached only with a recorded delivery (guard above): the recovery for a
      // RecordDelivery whose own task move did not land. Best-effort, as there:
      // an order already delivered refuses, and that refusal is not an error.
      try {
        await this.orderTransitions.transition(snapshot.orderId, 'delivered', {
          actorId: input.actorId,
          actorType: 'administrator',
          source: 'fulfilment',
          reasonCode: 'delivery_outcome',
          note: `Fulfilment task ${task.id} delivered`,
        });
        orderMirror = 'delivered';
      } catch {
        orderMirror = 'skipped';
      }
    }
    if (this.orderTransitions && to === 'OUT_FOR_DELIVERY') {
      try {
        await this.orderTransitions.transition(snapshot.orderId, 'dispatched', {
          actorId: input.actorId,
          actorType: 'administrator',
          source: 'fulfilment',
          reasonCode: 'task_dispatched',
          note: `Fulfilment task ${task.id} out for delivery`,
        });
        orderMirror = 'dispatched';
      } catch {
        orderMirror = 'skipped';
      }
    }

    await new CreateAuditLogUseCase(this.audit).execute({
      actorId: input.actorId,
      action: 'FULFILMENT_TASK_TRANSITIONED',
      entity: 'fulfilment_task',
      entityId: task.id,
      previousState: { status: from },
      newState: { status: to, assignedTo: input.assignedTo ?? null, notes: input.notes ?? null, orderMirror },
    });

    return { ok: true, taskId: task.id, orderId: snapshot.orderId, from, to };
  }
}
