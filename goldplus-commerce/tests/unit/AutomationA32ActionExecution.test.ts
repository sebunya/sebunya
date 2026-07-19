import { describe, expect, it } from 'vitest';
import { AutomationActionConfig, AutomationSuppressionReason } from '../../apps/api/src/domain/automation/Automation';
import { IAutomationEligibilityRepository, AutomationFrequencyCapRequest } from '../../apps/api/src/application/ports/IAutomationEligibilityRepository';
import { IAutomationActionRepository, IAutomationInternalActionExecutor, AutomationExternalIntentInput } from '../../apps/api/src/application/ports/IAutomationActionRepository';
import { EvaluateExecutionEligibilityUseCase } from '../../apps/api/src/application/use-cases/automation/EvaluateExecutionEligibilityUseCase';
import { ExecuteAutomationActionUseCase } from '../../apps/api/src/application/use-cases/automation/ExecuteAutomationActionUseCase';
import { AutomationInternalActionExecutor } from '../../apps/api/src/infrastructure/automation/AutomationInternalActionExecutor';
import { IOrderRepository } from '../../apps/api/src/application/use-cases/commerce/CheckoutUseCase';
import { CreateFulfilmentTaskOnOrderPlacedUseCase } from '../../apps/api/src/application/use-cases/fulfilment/CreateFulfilmentTaskOnOrderPlacedUseCase';
import { Order } from '../../apps/api/src/domain/commerce/Order';

class EligibilityRepo implements IAutomationEligibilityRepository {
  reservations = 0;
  suppressions: AutomationSuppressionReason[] = [];
  async recordSuppression(input: { reason: AutomationSuppressionReason }) { this.suppressions.push(input.reason); }
  async reserveFrequencyCap(_input: AutomationFrequencyCapRequest) {
    this.reservations += 1;
    return { reserved: true as const, reused: false as const, used: 1 };
  }
}

class ActionRepo implements IAutomationActionRepository {
  queued: AutomationExternalIntentInput[] = [];
  terminal: string[] = [];
  status: 'PLANNED' | 'PROCESSING' | 'INTERNAL_SUCCESS' = 'PLANNED';
  async queueExternalIntent(input: AutomationExternalIntentInput) {
    const duplicate = this.queued.length > 0;
    if (!duplicate) this.queued.push(input);
    return duplicate
      ? { outcome: 'DUPLICATE' as const, outboxEventId: 'outbox-1', capReused: true }
      : { outcome: 'QUEUED' as const, outboxEventId: 'outbox-1', capReused: false };
  }
  async claimInternal() {
    if (this.status === 'INTERNAL_SUCCESS') return 'COMPLETED' as const;
    if (this.status === 'PROCESSING') return 'BUSY' as const;
    this.status = 'PROCESSING';
    return 'CLAIMED' as const;
  }
  async completeInternal() { this.status = 'INTERNAL_SUCCESS'; }
  async markTerminal(_id: string, status: 'NOT_CONFIGURED' | 'SUPPRESSED') { this.terminal.push(status); }
}

class InternalExecutor implements IAutomationInternalActionExecutor {
  configured = true;
  calls = 0;
  async isConfigured() { return this.configured; }
  async execute() {
    this.calls += 1;
    return { effectId: 'effect-1', idempotentReplay: false };
  }
}

const action = (over: Partial<AutomationActionConfig> = {}): AutomationActionConfig => ({
  actionIndex: 0,
  family: 'CREATE_FULFILMENT_TASK',
  channel: null,
  config: { orderId: 'order-1' },
  ...over,
});

const input = (over: Record<string, unknown> = {}) => ({
  executionId: 'execution-1',
  actionExecutionId: 'action-1',
  definitionId: 'definition-1',
  versionId: 'version-1',
  windowKey: '2026-07-19',
  idempotencyKey: 'automation-action-1',
  frequency: { perCustomerPerWindow: 1, windowDays: 1, global: false, countsAttempts: false },
  action: action(),
  workerId: 'worker-1',
  definitionPaused: false,
  requiresApproval: false,
  approvalValid: true,
  subjectId: 'subject-1',
  audienceOutcome: 'ELIGIBLE' as const,
  consentEligible: true,
  conditionsPassed: true,
  ...over,
});

function harness() {
  const eligibilityRepo = new EligibilityRepo();
  const actionRepo = new ActionRepo();
  const internal = new InternalExecutor();
  const useCase = new ExecuteAutomationActionUseCase(
    new EvaluateExecutionEligibilityUseCase(eligibilityRepo),
    actionRepo,
    internal
  );
  return { eligibilityRepo, actionRepo, internal, useCase };
}

describe('Automation A3.2 — action execution boundary', () => {
  it('runs a configured internal action exactly once under duplicate execution', async () => {
    const h = harness();
    expect(await h.useCase.execute(input())).toMatchObject({ outcome: 'INTERNAL_SUCCESS', duplicate: false, providerCalls: 0 });
    expect(await h.useCase.execute(input())).toMatchObject({ outcome: 'INTERNAL_SUCCESS', duplicate: true, providerCalls: 0 });
    expect(h.internal.calls).toBe(1);
  });

  it('returns IN_PROGRESS instead of claiming success while another internal executor owns the action', async () => {
    const h = harness();
    h.actionRepo.status = 'PROCESSING';
    expect(await h.useCase.execute(input())).toEqual({ outcome: 'IN_PROGRESS', duplicate: true, providerCalls: 0 });
    expect(h.internal.calls).toBe(0);
  });

  it('persists one external outbox intent and never calls an internal/provider executor', async () => {
    const h = harness();
    const email = action({ family: 'EMAIL', channel: 'email', config: { template: 'approved-template' } });
    const first = await h.useCase.execute(input({ action: email }));
    const duplicate = await h.useCase.execute(input({ action: email }));
    expect(first).toEqual({ outcome: 'QUEUED', duplicate: false, outboxEventId: 'outbox-1', providerCalls: 0 });
    expect(duplicate).toEqual({ outcome: 'QUEUED', duplicate: true, outboxEventId: 'outbox-1', providerCalls: 0 });
    expect(h.actionRepo.queued).toHaveLength(1);
    expect(h.actionRepo.queued[0].cap).not.toBeNull();
    expect(h.eligibilityRepo.reservations).toBe(0);
    expect(h.internal.calls).toBe(0);
  });

  it('marks unsupported internal families NOT_CONFIGURED without reserving a cap', async () => {
    const h = harness();
    h.internal.configured = false;
    expect(await h.useCase.execute(input({ action: action({ family: 'CREATE_ADMIN_TASK', config: {} }) })))
      .toEqual({ outcome: 'NOT_CONFIGURED', duplicate: false, providerCalls: 0 });
    expect(h.actionRepo.terminal).toEqual(['NOT_CONFIGURED']);
    expect(h.eligibilityRepo.reservations).toBe(0);
  });

  it('persists exact gate suppression and creates no effect or intent', async () => {
    const h = harness();
    expect(await h.useCase.execute(input({ consentEligible: false }))).toEqual({
      outcome: 'SUPPRESSED', duplicate: false, reason: 'NO_CONSENT', providerCalls: 0,
    });
    expect(h.eligibilityRepo.suppressions).toEqual(['NO_CONSENT']);
    expect(h.actionRepo.terminal).toEqual(['SUPPRESSED']);
    expect(h.actionRepo.queued).toHaveLength(0);
    expect(h.internal.calls).toBe(0);
  });
});

describe('Automation A3.2 — native internal adapter', () => {
  it('delegates only configured fulfilment work to the existing idempotent use case', async () => {
    const order = { id: 'order-1' } as Order;
    const orders = {
      async findById(id: string) { return id === order.id ? order : null; },
      async save() {},
    } as IOrderRepository;
    let calls = 0;
    const createFulfilment = {
      async execute(received: Order) {
        calls += 1;
        expect(received).toBe(order);
        return { created: calls === 1, taskId: 'task-1', orderId: order.id };
      },
    } as unknown as CreateFulfilmentTaskOnOrderPlacedUseCase;
    const executor = new AutomationInternalActionExecutor(orders, createFulfilment);
    const configured = action({ family: 'CREATE_FULFILMENT_TASK', config: { orderId: order.id } });

    expect(await executor.isConfigured(configured)).toBe(true);
    expect(await executor.execute(configured)).toEqual({ effectId: 'task-1', idempotentReplay: false });
    expect(await executor.execute(configured)).toEqual({ effectId: 'task-1', idempotentReplay: true });
    expect(await executor.isConfigured(action({ family: 'CREATE_ADMIN_TASK', config: {} }))).toBe(false);
  });
});
