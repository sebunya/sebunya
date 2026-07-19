import {
  deriveSlaStage,
  buildSlaIdempotencyKey,
  FulfilmentSlaStage,
} from '../../../domain/fulfilment/FulfilmentTask';
import { IFulfilmentRepository } from '../../ports/IFulfilmentRepository';
import { IFulfilmentSlaEventRepository } from '../../ports/IFulfilmentSlaEventRepository';
import { IFulfilmentTeamRepository } from '../../ports/IFulfilmentTeamRepository';
import { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';

export interface EvaluateSlaResult {
  scanned: number;
  transitions: number;
  escalated: number;
  missingTeamLead: number;
  byStage: Record<string, number>;
}

/** Only these stages are recorded as notable SLA transitions. */
const NOTABLE: FulfilmentSlaStage[] = ['DUE_SOON', 'OVERDUE', 'ESCALATED'];

/**
 * F2 — deterministic, idempotent SLA evaluator. For each active task it derives
 * the SLA stage, and for a NOTABLE stage records exactly one event per
 * (task, stage, policy version) via a unique idempotency key. Repeated ticks and
 * concurrent workers never duplicate escalation (DB-level uniqueness). Escalated
 * tasks route to team leads; if none is configured it records MISSING_TEAM_LEAD
 * and does not fail. Terminal tasks are excluded (they are RESOLVED). No external
 * provider is called here.
 */
export class EvaluateFulfilmentSlaBatchUseCase {
  constructor(
    private readonly tasks: IFulfilmentRepository,
    private readonly slaEvents: IFulfilmentSlaEventRepository,
    private readonly teams: IFulfilmentTeamRepository,
    private readonly audit: IAuditRepository
  ) {}

  async execute(input: { now?: Date; limit?: number; actorId?: string } = {}): Promise<EvaluateSlaResult> {
    const now = input.now ?? new Date();
    const limit = Math.min(Math.max(1, input.limit ?? 500), 1000);
    const active = await this.tasks.findActiveForSla(limit);

    const result: EvaluateSlaResult = { scanned: active.length, transitions: 0, escalated: 0, missingTeamLead: 0, byStage: {} };

    for (const task of active) {
      const stage = deriveSlaStage({ now, createdAt: task.createdAt, slaDueAt: task.slaDueAt, terminal: false });
      result.byStage[stage] = (result.byStage[stage] ?? 0) + 1;
      if (!NOTABLE.includes(stage)) continue;

      const idempotencyKey = buildSlaIdempotencyKey(task.id, stage, task.slaPolicyVersion);
      let detail: string | null = null;
      if (stage === 'ESCALATED') {
        const leads = task.teamId ? await this.teams.listLeads(task.teamId) : [];
        if (leads.length === 0) {
          result.missingTeamLead++;
          detail = 'MISSING_TEAM_LEAD: routed to general fulfilment queue.';
        } else {
          detail = `escalated to ${leads.length} team lead(s).`;
        }
      }

      const { created } = await this.slaEvents.insertIfNew({
        taskId: task.id,
        stage,
        policyVersion: task.slaPolicyVersion,
        idempotencyKey,
        teamId: task.teamId,
        assigneeId: task.assignedTo,
        dueAtSnapshot: task.slaDueAt,
        prioritySnapshot: task.priority,
        detail,
      });

      if (created) {
        result.transitions++;
        if (stage === 'ESCALATED') result.escalated++;
        await new CreateAuditLogUseCase(this.audit).execute({
          actorId: input.actorId ?? null,
          action: `FULFILMENT_SLA_${stage}`,
          entity: 'fulfilment_task',
          entityId: task.id,
          newState: { stage, policyVersion: task.slaPolicyVersion, teamId: task.teamId, detail },
        });
      }
    }

    return result;
  }
}
