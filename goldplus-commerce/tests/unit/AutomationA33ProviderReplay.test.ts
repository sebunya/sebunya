import { describe, expect, it } from 'vitest';
import { AutomationActionConfig, AutomationSuppressionReason, AutomationVersionConfig, isReplayable } from '../../apps/api/src/domain/automation/Automation';
import { IAutomationActionRepository, AutomationReplayCandidate } from '../../apps/api/src/application/ports/IAutomationActionRepository';
import { IAutomationEligibilityRepository, AutomationFrequencyCapRequest } from '../../apps/api/src/application/ports/IAutomationEligibilityRepository';
import { IAutomationAudienceReader } from '../../apps/api/src/application/ports/IAutomationRepository';
import { IOutboxRepository } from '../../apps/api/src/application/ports/IOutboxRepository';
import { INotificationProvider } from '../../apps/api/src/application/ports/INotificationProvider';
import { EvaluateExecutionEligibilityUseCase } from '../../apps/api/src/application/use-cases/automation/EvaluateExecutionEligibilityUseCase';
import { ReplayAutomationActionUseCase } from '../../apps/api/src/application/use-cases/automation/ReplayAutomationActionUseCase';
import { ReconcileAutomationOutcomeUseCase } from '../../apps/api/src/application/use-cases/automation/ReconcileAutomationOutcomeUseCase';
import { AutomationOutcomeTrackingProvider } from '../../apps/api/src/infrastructure/automation/AutomationOutcomeTrackingProvider';

const action: AutomationActionConfig = { actionIndex: 0, family: 'EMAIL', channel: 'email', config: { template: 'approved', recipient: 'pilot@example.test' } };
const config: AutomationVersionConfig = {
  triggerFamily: 'DOMAIN_EVENT', triggerRef: 'OrderPlaced', audiencePolicyMode: 'REEVALUATE_AT_EXECUTION',
  conditions: [{ conditionId: 'active', category: 'lifecycle', operator: 'equals', expected: 'ACTIVE' }],
  actions: [action], schedule: null,
  frequency: { perCustomerPerWindow: 1, windowDays: 1, global: false, countsAttempts: false },
};
const candidate = (status: AutomationReplayCandidate['status']): AutomationReplayCandidate => ({
  actionExecutionId: 'action-1', executionId: 'execution-1', outboxEventId: 'outbox-1',
  definitionId: 'definition-1', versionId: 'version-1', versionNumber: 1,
  definitionPaused: false, requiresApproval: true, approvalValid: true,
  subjectId: 'subject-1', windowKey: '2026-07-19', status, action, config,
});

class ActionRepo implements IAutomationActionRepository {
  replayCandidate: AutomationReplayCandidate | null = candidate('DEAD_LETTERED');
  outcomes: Array<{ status: string; attempted: boolean }> = [];
  marked = 0;
  terminal: string[] = [];
  reconciled: Array<'SENT' | 'FAILED'> = [];
  providerState: AutomationReplayCandidate['status'] = 'QUEUED';
  providerAttempts = 0;
  async queueExternalIntent() { throw new Error('not used'); }
  async claimInternal() { return 'BUSY' as const; }
  async completeInternal() {}
  async markTerminal(_id: string, status: 'NOT_CONFIGURED' | 'SUPPRESSED') { this.terminal.push(status); }
  async claimProviderAttempt() {
    if (this.providerState === 'PROCESSING') return { outcome: 'BUSY' as const, attemptCount: this.providerAttempts };
    if (this.providerState !== 'QUEUED' && this.providerState !== 'FAILED' && this.providerState !== 'REPLAYED') {
      return { outcome: 'TERMINAL' as const, status: this.providerState, attemptCount: this.providerAttempts };
    }
    this.providerState = 'PROCESSING';
    this.providerAttempts += 1;
    return { outcome: 'CLAIMED' as const, attemptCount: this.providerAttempts };
  }
  async recordProviderOutcome(input: { status: 'SENT' | 'FAILED' | 'OUTCOME_UNKNOWN' | 'DRY_RUN' | 'NOT_CONFIGURED' | 'DISABLED'; attempted: boolean }) {
    this.outcomes.push(input);
    this.providerState = input.status;
    return { status: input.status, attemptCount: this.providerAttempts };
  }
  async findReplayCandidate() { return this.replayCandidate; }
  async markReplayed() { this.marked += 1; return true; }
  async reconcileUnknown(input: { resolution: 'SENT' | 'FAILED' }) { this.reconciled.push(input.resolution); return true; }
}

class EligibilityRepo implements IAutomationEligibilityRepository {
  reservations = 0;
  suppressions: AutomationSuppressionReason[] = [];
  async recordSuppression(input: { reason: AutomationSuppressionReason }) { this.suppressions.push(input.reason); }
  async reserveFrequencyCap(_input: AutomationFrequencyCapRequest) {
    this.reservations += 1;
    return { reserved: true as const, reused: true as const, used: 1 };
  }
}

class OutboxRepo implements IOutboxRepository {
  replayed = 0;
  async requeueForReplay() { this.replayed += 1; return true; }
  async claimDueBatch() { return []; }
  async markProcessed() {}
  async recordFailure() {}
  async findByRelatedEntity() { return []; }
  async enqueueAdminOrderEmail() { return { enqueued: false }; }
  async findById() { return null; }
  async listByEventType() { return []; }
}

const audience = (outcome: 'ELIGIBLE' | 'STALE_PROFILE' = 'ELIGIBLE'): IAutomationAudienceReader => ({
  async resolveSubject(subjectId: string) {
    return { outcome, subjectId, lifecycleStage: 'ACTIVE', consentEligible: true, identityConfidence: 'HIGH', computedAt: new Date('2026-07-19T00:00:00Z') };
  },
});

describe('Automation A3.3 — truthful provider outcomes', () => {
  const payload = { recipient: 'pilot@example.test', template: 'approved', data: {}, relatedEntity: 'automation_action', relatedEntityId: 'action-1' };

  it('enforces no-send without invoking the provider and records DISABLED', async () => {
    const repo = new ActionRepo();
    let calls = 0;
    const provider: INotificationProvider = { async dispatch() { calls += 1; return { status: 'SENT', providerCode: 'ok', providerMessage: 'sent' }; } };
    const result = await new AutomationOutcomeTrackingProvider(provider, repo, 'action-1', true).dispatch(payload);
    expect(result.status).toBe('DISABLED');
    expect(calls).toBe(0);
    expect(repo.outcomes).toEqual([{ status: 'DISABLED', attempted: false, providerCode: 'AUTOMATION_NO_SEND_GUARANTEE', providerMessage: 'Automation intent is no-send.', actionExecutionId: 'action-1' }]);
  });

  it('records SENT only after a positive provider response', async () => {
    const repo = new ActionRepo();
    const provider: INotificationProvider = { async dispatch() {
      expect(repo.providerState).toBe('PROCESSING');
      return { status: 'SENT', providerCode: 'message-1', providerMessage: 'accepted' };
    } };
    expect((await new AutomationOutcomeTrackingProvider(provider, repo, 'action-1', false).dispatch(payload)).status).toBe('SENT');
    expect(repo.outcomes[0]).toMatchObject({ status: 'SENT', attempted: true });
  });

  it('does not invoke a provider again after positive evidence is terminal', async () => {
    const repo = new ActionRepo();
    let calls = 0;
    const provider: INotificationProvider = { async dispatch() {
      calls += 1;
      return { status: 'SENT', providerCode: 'message-1', providerMessage: 'accepted' };
    } };
    const tracked = new AutomationOutcomeTrackingProvider(provider, repo, 'action-1', false);
    expect((await tracked.dispatch(payload)).status).toBe('SENT');
    expect((await tracked.dispatch(payload)).status).toBe('SENT');
    expect(calls).toBe(1);
    expect(repo.providerAttempts).toBe(1);
  });

  it('does not call transport while another provider attempt owns the lease', async () => {
    const repo = new ActionRepo();
    repo.providerState = 'PROCESSING';
    repo.providerAttempts = 1;
    let calls = 0;
    const provider: INotificationProvider = { async dispatch() {
      calls += 1;
      return { status: 'SENT', providerCode: 'unsafe', providerMessage: 'unsafe' };
    } };
    const result = await new AutomationOutcomeTrackingProvider(provider, repo, 'action-1', false).dispatch(payload);
    expect(result).toMatchObject({ status: 'DISABLED', providerCode: 'AUTOMATION_ATTEMPT_IN_PROGRESS' });
    expect(calls).toBe(0);
  });

  it('converts an ambiguous provider exception to terminal OUTCOME_UNKNOWN', async () => {
    const repo = new ActionRepo();
    const provider: INotificationProvider = { async dispatch() { throw new Error('connection closed after request'); } };
    expect((await new AutomationOutcomeTrackingProvider(provider, repo, 'action-1', false).dispatch(payload)).status).toBe('OUTCOME_UNKNOWN');
    expect(repo.outcomes[0]).toMatchObject({ status: 'OUTCOME_UNKNOWN', attempted: true });
  });

  it('maps dry-run simulation without claiming SENT or a provider attempt', async () => {
    const repo = new ActionRepo();
    const provider: INotificationProvider = { async dispatch() { return { status: 'SENT', providerCode: 'DRY_RUN_SUCCESS', providerMessage: 'simulated' }; } };
    expect((await new AutomationOutcomeTrackingProvider(provider, repo, 'action-1', false).dispatch(payload)).status).toBe('DRY_RUN');
    expect(repo.outcomes[0]).toMatchObject({ status: 'DRY_RUN', attempted: false });
  });

  it('short-circuits an explicit dry-run before the provider adapter', async () => {
    const repo = new ActionRepo();
    let calls = 0;
    const provider: INotificationProvider = { async dispatch() {
      calls += 1;
      return { status: 'SENT', providerCode: 'unsafe', providerMessage: 'unsafe' };
    } };
    const result = await new AutomationOutcomeTrackingProvider(provider, repo, 'action-1', true, 'DRY_RUN').dispatch(payload);
    expect(result.status).toBe('DRY_RUN');
    expect(calls).toBe(0);
    expect(repo.providerAttempts).toBe(0);
  });
});

describe('Automation A3.3 — gate-revalidated replay', () => {
  it('replays a dead letter once after full gates and reuses the original cap', async () => {
    const actions = new ActionRepo();
    const outbox = new OutboxRepo();
    const caps = new EligibilityRepo();
    const result = await new ReplayAutomationActionUseCase(
      actions, outbox, audience(), new EvaluateExecutionEligibilityUseCase(caps)
    ).execute({ actionExecutionId: 'action-1', actorId: 'actor-1', reason: 'operator-reviewed', now: new Date('2026-07-19T01:00:00Z') });
    expect(result).toEqual({ ok: true, actionExecutionId: 'action-1', capReused: true });
    expect(outbox.replayed).toBe(1);
    expect(actions.marked).toBe(1);
    expect(caps.reservations).toBe(1);
  });

  it.each(['SENT', 'INTERNAL_SUCCESS', 'OUTCOME_UNKNOWN'] as const)('never replays terminal %s', async (status) => {
    const actions = new ActionRepo();
    actions.replayCandidate = candidate(status);
    const outbox = new OutboxRepo();
    const result = await new ReplayAutomationActionUseCase(
      actions, outbox, audience(), new EvaluateExecutionEligibilityUseCase(new EligibilityRepo())
    ).execute({ actionExecutionId: 'action-1', actorId: 'actor-1', reason: 'unsafe' });
    expect(result).toEqual({ ok: false, code: 'NOT_REPLAYABLE' });
    expect(outbox.replayed).toBe(0);
  });

  it('persists fresh suppression and does not requeue when replay gates fail', async () => {
    const actions = new ActionRepo();
    const outbox = new OutboxRepo();
    const caps = new EligibilityRepo();
    const result = await new ReplayAutomationActionUseCase(
      actions, outbox, audience('STALE_PROFILE'), new EvaluateExecutionEligibilityUseCase(caps)
    ).execute({ actionExecutionId: 'action-1', actorId: 'actor-1', reason: 'stale' });
    expect(result).toEqual({ ok: false, code: 'SUPPRESSED', reason: 'STALE_PROFILE' });
    expect(caps.suppressions).toEqual(['STALE_PROFILE']);
    expect(outbox.replayed).toBe(0);
  });

  it('keeps OUTCOME_UNKNOWN non-replayable in the pure status contract', () => {
    expect(isReplayable('OUTCOME_UNKNOWN')).toBe(false);
    expect(isReplayable('DEAD_LETTERED')).toBe(true);
  });
});

describe('Automation A3.3 — ambiguous-outcome reconciliation', () => {
  it('requires operator evidence before resolving OUTCOME_UNKNOWN', async () => {
    const actions = new ActionRepo();
    const useCase = new ReconcileAutomationOutcomeUseCase(actions);
    expect(await useCase.execute({ actionExecutionId: 'action-1', resolution: 'SENT', actorId: 'actor-1', reason: '  ', evidence: 'provider-ledger-1' }))
      .toEqual({ ok: false, code: 'REASON_REQUIRED' });
    expect(actions.reconciled).toHaveLength(0);
  });

  it('requires actor and evidence independently', async () => {
    const actions = new ActionRepo();
    const useCase = new ReconcileAutomationOutcomeUseCase(actions);
    expect(await useCase.execute({ actionExecutionId: 'action-1', resolution: 'SENT', actorId: ' ', reason: 'reviewed', evidence: 'provider-ledger-1' }))
      .toEqual({ ok: false, code: 'ACTOR_REQUIRED' });
    expect(await useCase.execute({ actionExecutionId: 'action-1', resolution: 'SENT', actorId: 'actor-1', reason: 'reviewed', evidence: ' ' }))
      .toEqual({ ok: false, code: 'EVIDENCE_REQUIRED' });
    expect(actions.reconciled).toHaveLength(0);
  });

  it.each(['SENT', 'FAILED'] as const)('reconciles UNKNOWN to %s from explicit evidence', async (resolution) => {
    const actions = new ActionRepo();
    const result = await new ReconcileAutomationOutcomeUseCase(actions).execute({
      actionExecutionId: 'action-1', resolution, actorId: 'actor-1', reason: 'provider console reviewed', evidence: 'provider-ledger-1',
    });
    expect(result).toEqual({ ok: true, actionExecutionId: 'action-1', resolution });
    expect(actions.reconciled).toEqual([resolution]);
  });
});
