import { FulfilmentTask } from '../../../domain/fulfilment/FulfilmentTask';
import { IFulfilmentRepository } from '../../ports/IFulfilmentRepository';
import { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';

export type AssignFulfilmentResult =
  | { ok: true; taskId: string; assignedTo: string | null }
  | { ok: false; code: 'NOT_FOUND' | 'INVALID_ASSIGNMENT'; message: string };

/**
 * Assign (or unassign with assignedTo = null) a fulfilment task to a staff
 * member, audited. Refuses terminal tasks.
 */
export class AssignFulfilmentTaskUseCase {
  constructor(
    private readonly repo: IFulfilmentRepository,
    private readonly audit: IAuditRepository
  ) {}

  async execute(input: { taskId: string; assignedTo: string | null; actorId: string }): Promise<AssignFulfilmentResult> {
    const snapshot = await this.repo.findById(input.taskId);
    if (!snapshot) return { ok: false, code: 'NOT_FOUND', message: 'Fulfilment task not found.' };

    const previous = snapshot.assignedTo;
    const task = FulfilmentTask.rehydrate(snapshot);
    try {
      task.assign(input.assignedTo);
    } catch {
      return { ok: false, code: 'INVALID_ASSIGNMENT', message: `Cannot assign a ${snapshot.status} task.` };
    }

    await this.repo.update(task);
    await new CreateAuditLogUseCase(this.audit).execute({
      actorId: input.actorId,
      action: input.assignedTo ? 'FULFILMENT_TASK_ASSIGNED' : 'FULFILMENT_TASK_UNASSIGNED',
      entity: 'fulfilment_task',
      entityId: task.id,
      previousState: { assignedTo: previous },
      newState: { assignedTo: input.assignedTo },
    });

    return { ok: true, taskId: task.id, assignedTo: input.assignedTo };
  }
}
