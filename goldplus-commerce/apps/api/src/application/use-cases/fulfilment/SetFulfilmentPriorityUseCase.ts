import {
  FulfilmentTask,
  FulfilmentPriority,
  FULFILMENT_PRIORITIES,
} from '../../../domain/fulfilment/FulfilmentTask';
import { IFulfilmentRepository } from '../../ports/IFulfilmentRepository';
import { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';

export type SetFulfilmentPriorityResult =
  | { ok: true; taskId: string; priority: FulfilmentPriority; slaDueAt: Date }
  | { ok: false; code: 'NOT_FOUND' | 'INVALID_PRIORITY'; message: string };

/**
 * Change a task's priority. The SLA deadline is recomputed deterministically
 * from the task's original creation time (never gameable by re-prioritising
 * late). Audited; refuses terminal tasks.
 */
export class SetFulfilmentPriorityUseCase {
  constructor(
    private readonly repo: IFulfilmentRepository,
    private readonly audit: IAuditRepository
  ) {}

  async execute(input: { taskId: string; priority: string; actorId: string }): Promise<SetFulfilmentPriorityResult> {
    if (!FULFILMENT_PRIORITIES.includes(input.priority as FulfilmentPriority)) {
      return { ok: false, code: 'INVALID_PRIORITY', message: `Unknown priority "${input.priority}".` };
    }
    const priority = input.priority as FulfilmentPriority;

    const snapshot = await this.repo.findById(input.taskId);
    if (!snapshot) return { ok: false, code: 'NOT_FOUND', message: 'Fulfilment task not found.' };

    const previous = snapshot.priority;
    const task = FulfilmentTask.rehydrate(snapshot);
    try {
      task.setPriority(priority);
    } catch {
      return { ok: false, code: 'INVALID_PRIORITY', message: `Cannot re-prioritise a ${snapshot.status} task.` };
    }

    await this.repo.update(task);
    await new CreateAuditLogUseCase(this.audit).execute({
      actorId: input.actorId,
      action: 'FULFILMENT_TASK_REPRIORITISED',
      entity: 'fulfilment_task',
      entityId: task.id,
      previousState: { priority: previous },
      newState: { priority, slaDueAt: task.slaDueAt.toISOString() },
    });

    return { ok: true, taskId: task.id, priority, slaDueAt: task.slaDueAt };
  }
}
