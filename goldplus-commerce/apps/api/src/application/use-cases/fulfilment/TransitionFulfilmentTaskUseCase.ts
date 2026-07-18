import { FulfilmentTask, FulfilmentStatus, FULFILMENT_STATUSES } from '../../../domain/fulfilment/FulfilmentTask';
import { IFulfilmentRepository } from '../../ports/IFulfilmentRepository';
import { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';

export type TransitionFulfilmentResult =
  | { ok: true; taskId: string; from: FulfilmentStatus; to: FulfilmentStatus }
  | { ok: false; code: 'NOT_FOUND' | 'INVALID_STATUS' | 'INVALID_TRANSITION'; message: string };

/**
 * Authorised admin transition of a fulfilment task through its lifecycle.
 * Validates the target status, enforces the pure transition rules, persists the
 * change, and writes an audit-log timeline entry (entity = fulfilment_task).
 */
export class TransitionFulfilmentTaskUseCase {
  constructor(
    private readonly repo: IFulfilmentRepository,
    private readonly audit: IAuditRepository
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
    await new CreateAuditLogUseCase(this.audit).execute({
      actorId: input.actorId,
      action: 'FULFILMENT_TASK_TRANSITIONED',
      entity: 'fulfilment_task',
      entityId: task.id,
      previousState: { status: from },
      newState: { status: to, assignedTo: input.assignedTo ?? null, notes: input.notes ?? null },
    });

    return { ok: true, taskId: task.id, from, to };
  }
}
