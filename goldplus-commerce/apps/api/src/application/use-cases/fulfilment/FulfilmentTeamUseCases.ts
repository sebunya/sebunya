import { FulfilmentTask } from '../../../domain/fulfilment/FulfilmentTask';
import { IFulfilmentRepository } from '../../ports/IFulfilmentRepository';
import { IFulfilmentTeamRepository, FulfilmentTeam } from '../../ports/IFulfilmentTeamRepository';
import { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 140);
}

export class CreateFulfilmentTeamUseCase {
  constructor(private readonly teams: IFulfilmentTeamRepository, private readonly audit: IAuditRepository) {}
  async execute(input: { name: string; actorId: string }): Promise<{ ok: true; team: FulfilmentTeam } | { ok: false; code: 'INVALID' | 'DUPLICATE'; message: string }> {
    const name = (input.name ?? '').trim();
    if (name.length < 2 || name.length > 120) return { ok: false, code: 'INVALID', message: 'Team name must be 2–120 characters.' };
    const result = await this.teams.createTeam({ name, slug: slugify(name) });
    if (!result.ok) return { ok: false, code: 'DUPLICATE', message: 'A team with this name already exists.' };
    await new CreateAuditLogUseCase(this.audit).execute({
      actorId: input.actorId, action: 'FULFILMENT_TEAM_CREATED', entity: 'fulfilment_team', entityId: result.team.id,
      newState: { name: result.team.name, slug: result.team.slug },
    });
    return { ok: true, team: result.team };
  }
}

export class ListFulfilmentTeamsUseCase {
  constructor(private readonly teams: IFulfilmentTeamRepository) {}
  execute() { return this.teams.listTeams(); }
}

export class ManageTeamMemberUseCase {
  constructor(private readonly teams: IFulfilmentTeamRepository, private readonly audit: IAuditRepository) {}
  async execute(input: { teamId: string; userId: string; action: 'add' | 'remove'; actorId: string }): Promise<{ ok: true } | { ok: false; code: 'NOT_FOUND'; message: string }> {
    const team = await this.teams.findById(input.teamId);
    if (!team) return { ok: false, code: 'NOT_FOUND', message: 'Team not found.' };
    if (input.action === 'add') await this.teams.addMember(input.teamId, input.userId);
    else await this.teams.removeMember(input.teamId, input.userId);
    await new CreateAuditLogUseCase(this.audit).execute({
      actorId: input.actorId,
      action: input.action === 'add' ? 'FULFILMENT_TEAM_MEMBER_ADDED' : 'FULFILMENT_TEAM_MEMBER_REMOVED',
      entity: 'fulfilment_team', entityId: input.teamId, newState: { userId: input.userId },
    });
    return { ok: true };
  }
}

/** Move a task to a team queue (owner). Clears an assignee no longer eligible. */
export class MoveFulfilmentTeamUseCase {
  constructor(
    private readonly repo: IFulfilmentRepository,
    private readonly teams: IFulfilmentTeamRepository,
    private readonly audit: IAuditRepository
  ) {}
  async execute(input: { taskId: string; teamId: string | null; actorId: string }): Promise<{ ok: true; taskId: string } | { ok: false; code: 'NOT_FOUND' | 'TEAM_NOT_FOUND' | 'INVALID_ASSIGNMENT'; message: string }> {
    const snapshot = await this.repo.findById(input.taskId);
    if (!snapshot) return { ok: false, code: 'NOT_FOUND', message: 'Fulfilment task not found.' };
    if (input.teamId) {
      const team = await this.teams.findById(input.teamId);
      if (!team) return { ok: false, code: 'TEAM_NOT_FOUND', message: 'Team not found.' };
    }
    // If the current assignee is not a member of the new team, clear the assignee.
    let clearAssignee = false;
    if (input.teamId && snapshot.assignedTo) {
      clearAssignee = !(await this.teams.isMember(input.teamId, snapshot.assignedTo));
    }
    const task = FulfilmentTask.rehydrate(snapshot);
    try {
      task.assignToTeam(input.teamId, { clearAssignee });
    } catch {
      return { ok: false, code: 'INVALID_ASSIGNMENT', message: `Cannot move a ${snapshot.status} task between teams.` };
    }
    await this.repo.update(task);
    await new CreateAuditLogUseCase(this.audit).execute({
      actorId: input.actorId, action: 'FULFILMENT_TASK_TEAM_MOVED', entity: 'fulfilment_task', entityId: task.id,
      previousState: { teamId: snapshot.teamId, assignedTo: snapshot.assignedTo },
      newState: { teamId: input.teamId, assigneeCleared: clearAssignee },
    });
    return { ok: true, taskId: task.id };
  }
}

/** Bounded bulk assignment of many tasks to one assignee (idempotent, eligibility-checked). */
export class BulkAssignFulfilmentTasksUseCase {
  static readonly MAX_BATCH = 100;
  constructor(
    private readonly repo: IFulfilmentRepository,
    private readonly teams: IFulfilmentTeamRepository,
    private readonly audit: IAuditRepository
  ) {}
  async execute(input: { taskIds: string[]; assignedTo: string | null; actorId: string }): Promise<{ ok: true; assigned: number; skipped: number } | { ok: false; code: 'TOO_MANY' | 'EMPTY'; message: string }> {
    const ids = [...new Set(input.taskIds.filter(Boolean))];
    if (ids.length === 0) return { ok: false, code: 'EMPTY', message: 'No task ids supplied.' };
    if (ids.length > BulkAssignFulfilmentTasksUseCase.MAX_BATCH) {
      return { ok: false, code: 'TOO_MANY', message: `Bulk assignment limited to ${BulkAssignFulfilmentTasksUseCase.MAX_BATCH} tasks.` };
    }
    let assigned = 0;
    let skipped = 0;
    for (const id of ids) {
      const snapshot = await this.repo.findById(id);
      if (!snapshot) { skipped++; continue; }
      // Eligibility: assigning a user to a team-owned task requires membership.
      if (input.assignedTo && snapshot.teamId && !(await this.teams.isMember(snapshot.teamId, input.assignedTo))) {
        skipped++; continue;
      }
      if (snapshot.assignedTo === input.assignedTo) { assigned++; continue; } // idempotent
      const task = FulfilmentTask.rehydrate(snapshot);
      try { task.assign(input.assignedTo); } catch { skipped++; continue; }
      await this.repo.update(task);
      assigned++;
    }
    await new CreateAuditLogUseCase(this.audit).execute({
      actorId: input.actorId, action: 'FULFILMENT_TASK_BULK_ASSIGNED', entity: 'fulfilment_task', entityId: input.actorId,
      newState: { assignedTo: input.assignedTo, assigned, skipped, count: ids.length },
    });
    return { ok: true, assigned, skipped };
  }
}
