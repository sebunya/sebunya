import { describe, it, expect } from 'vitest';
import { evaluateConditions } from '../../apps/api/src/domain/automation/Automation';
import { PlanAutomationExecutionUseCase } from '../../apps/api/src/application/use-cases/automation/PlanAutomationExecutionUseCase';
import { IAutomationRepository, IAutomationExecutionRepository, IAutomationAudienceReader, ActiveAutomation, AutomationPlanInput, AudienceResolution } from '../../apps/api/src/application/ports/IAutomationRepository';

const now = new Date('2026-07-19T00:00:00Z');

describe('Automation A2 — condition evaluation', () => {
  it('evaluates lifecycle and consent conditions into evidence', () => {
    const r = evaluateConditions(
      [{ conditionId: 'c1', category: 'lifecycle', operator: 'equals', expected: 'ACTIVE' }, { conditionId: 'c2', category: 'consent', operator: 'equals', expected: true }],
      { lifecycleStage: 'ACTIVE', consentEligible: true, identityConfidence: 'HIGH', now }
    );
    expect(r.allPassed).toBe(true);
    expect(r.evidence).toHaveLength(2);
    expect(r.evidence[0]).toMatchObject({ inputValue: 'ACTIVE', result: true, source: 'customer_profiles' });
  });
  it('fails when a condition does not match', () => {
    const r = evaluateConditions([{ conditionId: 'c1', category: 'lifecycle', operator: 'equals', expected: 'ACTIVE' }], { lifecycleStage: 'LAPSED', consentEligible: true, identityConfidence: 'HIGH', now });
    expect(r.allPassed).toBe(false);
    expect(r.evidence[0].result).toBe(false);
  });
});

// ---------- fakes ----------
const activeAutomation = (over: Partial<ActiveAutomation> = {}): ActiveAutomation => ({
  definitionId: 'd1', versionId: 'v1', versionNumber: 1, requiresApproval: false, approvalValid: true,
  config: { triggerFamily: 'DOMAIN_EVENT', triggerRef: 'OrderPlaced', audiencePolicyMode: 'REEVALUATE_AT_EXECUTION', conditions: [{ conditionId: 'c1', category: 'lifecycle', operator: 'equals', expected: 'ACTIVE' }], actions: [{ actionIndex: 0, family: 'INTERNAL_NOTIFICATION', channel: null, config: {} }], schedule: null, frequency: null },
  ...over,
});
class AutoRepo implements IAutomationRepository {
  constructor(private list: ActiveAutomation[]) {}
  async findActiveApprovedByTrigger() { return this.list; }
  async isDefinitionPaused() { return false; }
}
class ExecRepo implements IAutomationExecutionRepository {
  byKey = new Map<string, { id: string; actions: number }>(); n = 1;
  async persistPlan(input: AutomationPlanInput) {
    if (this.byKey.has(input.triggerExecutionKey)) return { created: false, executionId: this.byKey.get(input.triggerExecutionKey)!.id };
    const id = `e${this.n++}`; this.byKey.set(input.triggerExecutionKey, { id, actions: input.plannedActions.length }); return { created: true, executionId: id };
  }
  async findByTriggerKey(k: string) { const e = this.byKey.get(k); return e ? { id: e.id, status: 'PLANNED' } : null; }
  async countActionsForExecution(id: string) { return [...this.byKey.values()].find((e) => e.id === id)?.actions ?? 0; }
}
class Audience implements IAutomationAudienceReader {
  constructor(private map: Record<string, AudienceResolution>) {}
  async resolveSubject(subjectId: string) { return this.map[subjectId] ?? { outcome: 'NO_PROFILE', subjectId, lifecycleStage: null, consentEligible: null, identityConfidence: null, computedAt: null }; }
}
const eligible = (id: string): AudienceResolution => ({ outcome: 'ELIGIBLE', subjectId: id, lifecycleStage: 'ACTIVE', consentEligible: true, identityConfidence: 'HIGH', computedAt: now });

describe('Automation A2 — planning use case', () => {
  it('plans an eligible subject and persists actions', async () => {
    const exec = new ExecRepo();
    const uc = new PlanAutomationExecutionUseCase(new AutoRepo([activeAutomation()]), exec, new Audience({ s1: eligible('s1') }));
    const r = await uc.execute({ triggerFamily: 'DOMAIN_EVENT', triggerRef: 'OrderPlaced', triggerEventId: 't1', subjectId: 's1', now });
    expect(r.result.planned).toBe(1);
    expect(exec.byKey.size).toBe(1);
  });
  it('is idempotent for a duplicate trigger', async () => {
    const exec = new ExecRepo();
    const uc = new PlanAutomationExecutionUseCase(new AutoRepo([activeAutomation()]), exec, new Audience({ s1: eligible('s1') }));
    await uc.execute({ triggerFamily: 'DOMAIN_EVENT', triggerRef: 'OrderPlaced', triggerEventId: 't1', subjectId: 's1', now });
    const again = await uc.execute({ triggerFamily: 'DOMAIN_EVENT', triggerRef: 'OrderPlaced', triggerEventId: 't1', subjectId: 's1', now });
    expect(again.result.duplicate).toBe(1);
    expect(exec.byKey.size).toBe(1);
  });
  it('marks a failing-condition subject INELIGIBLE with no actions', async () => {
    const exec = new ExecRepo();
    const uc = new PlanAutomationExecutionUseCase(new AutoRepo([activeAutomation()]), exec, new Audience({ s2: { outcome: 'ELIGIBLE', subjectId: 's2', lifecycleStage: 'LAPSED', consentEligible: true, identityConfidence: 'HIGH', computedAt: now } }));
    const r = await uc.execute({ triggerFamily: 'DOMAIN_EVENT', triggerRef: 'OrderPlaced', triggerEventId: 't2', subjectId: 's2', now });
    expect(r.result.ineligible).toBe(1);
    expect(r.result.planned).toBe(0);
  });
  it('reports NO_DATA for a subject without a profile', async () => {
    const uc = new PlanAutomationExecutionUseCase(new AutoRepo([activeAutomation()]), new ExecRepo(), new Audience({}));
    const r = await uc.execute({ triggerFamily: 'DOMAIN_EVENT', triggerRef: 'OrderPlaced', triggerEventId: 't3', subjectId: 'ghost', now });
    expect(r.result.noData).toBe(1);
    expect(r.result.ineligible).toBe(1);
  });
  it('plans nothing when no active automation matches the trigger', async () => {
    const r = await new PlanAutomationExecutionUseCase(new AutoRepo([]), new ExecRepo(), new Audience({ s1: eligible('s1') })).execute({ triggerFamily: 'DOMAIN_EVENT', triggerRef: 'OrderPlaced', triggerEventId: 't4', subjectId: 's1', now });
    expect(r.result.matchedAutomations).toBe(0);
    expect(r.result.planned).toBe(0);
  });
});
