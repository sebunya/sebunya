import { FulfilmentTask } from '../../../domain/fulfilment/FulfilmentTask';
import { IFulfilmentRepository } from '../../ports/IFulfilmentRepository';
import { IFulfilmentTeamRepository } from '../../ports/IFulfilmentTeamRepository';
import { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';

export type AssignFulfilmentResult =
  | { ok: true; taskId: string; assignedTo: string | null }
  | { ok: false; code: 'NOT_FOUND' | 'INVALID_ASSIGNMENT' | 'NOT_TEAM_ELIGIBLE'; message: string };

/**
 * Assign (or unassign with assignedTo = null) a fulfilment task to a staff
 * member, audited. Refuses terminal tasks. When the task belongs to a team, the
 * individual assignee must be an active member of that team (eligibility).
 * Idempotent: assigning the same user again is a no-op success.
 */
export class AssignFulfilmentTaskUseCase {
  constructor(
    private readonly repo: IFulfilmentRepository,
    private readonly audit: IAuditRepository,
    private readonly teams?: IFulfilmentTeamRepository
  ) {}

  async execute(input: { taskId: string; assignedTo: string | null; actorId: string }): Promise<AssignFulfilmentResult> {
    const snapshot = await this.repo.findById(input.taskId);
    if (!snapshot) return { ok: false, code: 'NOT_FOUND', message: 'Fulfilment task not found.' };

    if (input.assignedTo && snapshot.teamId && this.teams) {
      const eligible = await this.teams.isMember(snapshot.teamId, input.assignedTo);
      if (!eligible) return { ok: false, code: 'NOT_TEAM_ELIGIBLE', message: 'Assignee is not a member of the task’s team.' };
    }

    const previous = snapshot.assignedTo;
    if (previous === input.assignedTo) {
      return { ok: true, taskId: snapshot.id, assignedTo: input.assignedTo }; // idempotent
    }
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
