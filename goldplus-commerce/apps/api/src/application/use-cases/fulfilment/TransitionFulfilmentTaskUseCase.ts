import { FulfilmentTask, FulfilmentStatus, FULFILMENT_STATUSES } from '../../../domain/fulfilment/FulfilmentTask';
import { IFulfilmentRepository } from '../../ports/IFulfilmentRepository';
import { IAuditRepository } from '../../ports/IAuditRepository';
import { IOrderTransitionPort } from '../../ports/IOrderTransitionPort';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';

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
     * construct unchanged; when wired, both are refused.
     */
    private readonly guards?: {
      dispatches?: { getByTask(taskId: string): Promise<unknown | null> };
      packingSessions?: { getByTask(taskId: string): Promise<{ status: string } | null> };
    },
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

    if (to === 'OUT_FOR_DELIVERY' && this.guards?.dispatches) {
      const dispatch = await this.guards.dispatches.getByTask(input.taskId);
      if (!dispatch) {
        return { ok: false, code: 'INVALID_TRANSITION', message: 'Record the dispatch first. Marking a task out for delivery without a dispatch record skips the payment check.' };
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

    let orderMirror: 'dispatched' | 'skipped' | 'not_wired' = 'not_wired';
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
