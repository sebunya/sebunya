import { describe, it, expect } from 'vitest';
import {
  canTransitionDefinition, isReplayable, isApprovalValid, validateVersionConfig, isVersionMutable, canActivate,
  computeNextRun, resolveMisfire, buildTriggerExecutionKey, buildActionIdempotencyKey, isSupportedAction, isCustomerFacingAction,
  AutomationVersionConfig, AutomationScheduleConfig,
} from '../../apps/api/src/domain/automation/Automation';

const now = new Date('2026-07-19T00:00:00Z');
const cfg = (over: Partial<AutomationVersionConfig> = {}): AutomationVersionConfig => ({
  triggerFamily: 'DOMAIN_EVENT', triggerRef: 'OrderPlaced', audiencePolicyMode: 'REEVALUATE_AT_EXECUTION',
  conditions: [], actions: [{ actionIndex: 0, family: 'INTERNAL_NOTIFICATION', channel: null, config: {} }], schedule: null, frequency: null, ...over,
});

describe('Automation A1 — definition lifecycle', () => {
  it('permits governed transitions and rejects invalid ones', () => {
    expect(canTransitionDefinition('DRAFT', 'READY_FOR_REVIEW')).toBe(true);
    expect(canTransitionDefinition('READY_FOR_REVIEW', 'APPROVED')).toBe(true);
    expect(canTransitionDefinition('APPROVED', 'ACTIVE')).toBe(true);
    expect(canTransitionDefinition('ACTIVE', 'PAUSED')).toBe(true);
    expect(canTransitionDefinition('PAUSED', 'ACTIVE')).toBe(true);
    expect(canTransitionDefinition('DRAFT', 'ACTIVE')).toBe(false); // must be approved
    expect(canTransitionDefinition('ARCHIVED', 'ACTIVE')).toBe(false);
    expect(canTransitionDefinition('ACTIVE', 'DRAFT')).toBe(false);
  });
  it('keeps definition and execution state separate (replayability is an execution concern)', () => {
    expect(isReplayable('FAILED')).toBe(true);
    expect(isReplayable('DEAD_LETTERED')).toBe(true);
    expect(isReplayable('SENT')).toBe(false);
    expect(isReplayable('INTERNAL_SUCCESS')).toBe(false);
  });
});

describe('Automation A1 — versioning, actions and approval', () => {
  it('rejects unsupported actions and empty action sets', () => {
    expect(validateVersionConfig(cfg({ actions: [] }))).toEqual({ ok: false, code: 'NO_ACTIONS' });
    expect(validateVersionConfig(cfg({ actions: [{ actionIndex: 0, family: 'SMS_BLAST' as any, channel: null, config: {} }] }))).toEqual({ ok: false, code: 'UNSUPPORTED_ACTION' });
    expect(isSupportedAction('EMAIL')).toBe(true);
    expect(isSupportedAction('TELEPATHY')).toBe(false);
  });
  it('requires approval only for customer-facing actions', () => {
    expect(validateVersionConfig(cfg())).toEqual({ ok: true, requiresApproval: false });
    expect(validateVersionConfig(cfg({ actions: [{ actionIndex: 0, family: 'EMAIL', channel: 'email', config: {} }] }))).toEqual({ ok: true, requiresApproval: true });
    expect(isCustomerFacingAction('WHATSAPP_TEMPLATE')).toBe(true);
    expect(isCustomerFacingAction('CREATE_ADMIN_TASK')).toBe(false);
  });
  it('requires a schedule for SCHEDULED triggers', () => {
    expect(validateVersionConfig(cfg({ triggerFamily: 'SCHEDULED', schedule: null })).ok).toBe(false);
    expect(validateVersionConfig(cfg({ triggerFamily: 'SCHEDULED', schedule: { timezone: 'Africa/Kampala', intervalMinutes: 60, effectiveStart: null, effectiveEnd: null, misfirePolicy: 'SKIP' } })).ok).toBe(true);
  });
  it('requires positive configured frequency caps and windows', () => {
    expect(validateVersionConfig(cfg({ frequency: { perCustomerPerWindow: 0, windowDays: 1, global: false, countsAttempts: false } })))
      .toEqual({ ok: false, code: 'INVALID_FREQUENCY_CAP' });
    expect(validateVersionConfig(cfg({ frequency: { perCustomerPerWindow: -1, windowDays: 1, global: false, countsAttempts: false } })))
      .toEqual({ ok: false, code: 'INVALID_FREQUENCY_CAP' });
    expect(validateVersionConfig(cfg({ frequency: { perCustomerPerWindow: 1, windowDays: 0, global: false, countsAttempts: false } })))
      .toEqual({ ok: false, code: 'INVALID_FREQUENCY_WINDOW' });
    expect(validateVersionConfig(cfg({ frequency: { perCustomerPerWindow: 1, windowDays: 7, global: false, countsAttempts: false } })))
      .toEqual({ ok: true, requiresApproval: false });
  });
  it('freezes an approved version and gates activation on valid approval', () => {
    expect(isVersionMutable('DRAFT', 'PENDING')).toBe(true);
    expect(isVersionMutable('ACTIVE', 'APPROVED')).toBe(false);
    expect(isVersionMutable('READY_FOR_REVIEW', 'APPROVED')).toBe(false);
    const good = canActivate({ requiresApproval: true, approval: { status: 'APPROVED', versionNumber: 1, expiresAt: null }, now });
    expect(good.ok).toBe(true);
    const expired = canActivate({ requiresApproval: true, approval: { status: 'APPROVED', versionNumber: 1, expiresAt: new Date(now.getTime() - 1000) }, now });
    expect(expired).toEqual({ ok: false, code: 'APPROVAL_EXPIRED' });
    const missing = canActivate({ requiresApproval: true, approval: { status: 'PENDING', versionNumber: 1, expiresAt: null }, now });
    expect(missing).toEqual({ ok: false, code: 'APPROVAL_REQUIRED' });
    expect(canActivate({ requiresApproval: false, approval: { status: 'NOT_REQUIRED', versionNumber: 1, expiresAt: null }, now }).ok).toBe(true);
  });
  it('validates approval freshness', () => {
    expect(isApprovalValid({ status: 'APPROVED', versionNumber: 1, expiresAt: null }, now)).toBe(true);
    expect(isApprovalValid({ status: 'APPROVED', versionNumber: 1, expiresAt: new Date(now.getTime() - 1) }, now)).toBe(false);
    expect(isApprovalValid({ status: 'EXPIRED', versionNumber: 1, expiresAt: null }, now)).toBe(false);
  });
});

describe('Automation A1 — schedule, misfire and idempotency keys', () => {
  const sched = (over: Partial<AutomationScheduleConfig> = {}): AutomationScheduleConfig => ({ timezone: 'Africa/Kampala', intervalMinutes: 60, effectiveStart: null, effectiveEnd: null, misfirePolicy: 'SKIP', ...over });
  it('computes next run and honours effective end', () => {
    expect(computeNextRun(sched(), now)?.toISOString()).toBe('2026-07-19T01:00:00.000Z');
    expect(computeNextRun(sched({ effectiveEnd: now }), now)).toBeNull();
  });
  it('applies misfire policy: SKIP realigns, RUN_ONCE fires one catch-up', () => {
    const expected = new Date(now.getTime() - 3 * 3600_000); // 3h overdue
    expect(resolveMisfire(sched({ misfirePolicy: 'SKIP' }), expected, now).action).toBe('SKIP');
    expect(resolveMisfire(sched({ misfirePolicy: 'RUN_ONCE' }), expected, now).action).toBe('RUN');
    // on-time is always RUN
    expect(resolveMisfire(sched(), new Date(now.getTime() - 60_000), now).action).toBe('RUN');
  });
  it('builds deterministic idempotency keys', () => {
    expect(buildTriggerExecutionKey('a1', 2, 'evt9')).toBe('automation:a1:v2:trigger:evt9');
    expect(buildActionIdempotencyKey('a1', 2, 'cust7', '2026-W29', 0)).toBe('automation:a1:v2:subject:cust7:window:2026-W29:action:0');
  });
});
