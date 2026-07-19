/**
 * Automation — governed, versioned, internal-first control-plane domain (pure).
 *
 * A definition owns immutable versions. Once a version is APPROVED/ACTIVE its
 * trigger, audience, conditions, actions, schedule and policies are frozen — a
 * change creates a new version needing new approval. Definition state and
 * execution state are separate. Customer-facing actions always require an explicit
 * approval tied to the exact version; feature flags never imply approval. No
 * provider calls, no wall-clock reads inside logic (callers pass `now`).
 */

// ---------- definition lifecycle ----------
export type DefinitionStatus = 'DRAFT' | 'READY_FOR_REVIEW' | 'APPROVED' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED' | 'REJECTED';
export const DEFINITION_STATUSES: readonly DefinitionStatus[] = ['DRAFT', 'READY_FOR_REVIEW', 'APPROVED', 'ACTIVE', 'PAUSED', 'ARCHIVED', 'REJECTED'];

const DEF_FORWARD: Record<DefinitionStatus, DefinitionStatus[]> = {
  DRAFT: ['READY_FOR_REVIEW', 'ARCHIVED'],
  READY_FOR_REVIEW: ['APPROVED', 'REJECTED'],
  APPROVED: ['ACTIVE', 'ARCHIVED'],
  ACTIVE: ['PAUSED'],
  PAUSED: ['ACTIVE', 'ARCHIVED'],
  REJECTED: ['ARCHIVED'],
  ARCHIVED: [],
};
export function canTransitionDefinition(from: DefinitionStatus, to: DefinitionStatus): boolean {
  if (from === to) return false;
  return DEF_FORWARD[from]?.includes(to) ?? false;
}
export function isDefinitionTerminal(s: DefinitionStatus): boolean { return s === 'ARCHIVED'; }

// ---------- execution lifecycle (separate from definition) ----------
export type ExecutionStatus =
  | 'PLANNED' | 'INELIGIBLE' | 'ELIGIBLE' | 'SUPPRESSED' | 'DRY_RUN' | 'QUEUED' | 'PROCESSING'
  | 'INTERNAL_SUCCESS' | 'SENT' | 'FAILED' | 'DEAD_LETTERED' | 'REPLAYED' | 'CANCELLED' | 'NOT_CONFIGURED' | 'DISABLED';
export const EXECUTION_STATUSES: readonly ExecutionStatus[] = [
  'PLANNED', 'INELIGIBLE', 'ELIGIBLE', 'SUPPRESSED', 'DRY_RUN', 'QUEUED', 'PROCESSING',
  'INTERNAL_SUCCESS', 'SENT', 'FAILED', 'DEAD_LETTERED', 'REPLAYED', 'CANCELLED', 'NOT_CONFIGURED', 'DISABLED',
];
/** A successful effect can never be replayed. */
export function isReplayable(status: ExecutionStatus): boolean {
  return status === 'FAILED' || status === 'DEAD_LETTERED';
}

// ---------- approval ----------
export type ApprovalStatus = 'NOT_REQUIRED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED';
export interface ApprovalSnapshot { status: ApprovalStatus; versionNumber: number; expiresAt: Date | null; }
export function isApprovalValid(a: ApprovalSnapshot, now: Date): boolean {
  if (a.status !== 'APPROVED') return false;
  if (a.expiresAt && now.getTime() >= a.expiresAt.getTime()) return false;
  return true;
}

// ---------- triggers ----------
export type TriggerFamily = 'DOMAIN_EVENT' | 'SCHEDULED' | 'DECISION_RECOMMENDATION' | 'CUSTOMER_STATE_CHANGE' | 'MANUAL_ADMIN';
export const TRIGGER_FAMILIES: readonly TriggerFamily[] = ['DOMAIN_EVENT', 'SCHEDULED', 'DECISION_RECOMMENDATION', 'CUSTOMER_STATE_CHANGE', 'MANUAL_ADMIN'];

// ---------- actions ----------
export type ActionFamily =
  | 'INTERNAL_NOTIFICATION' | 'CREATE_ADMIN_TASK' | 'CREATE_FULFILMENT_TASK' | 'CREATE_SUPPORT_TASK'
  | 'EMAIL' | 'WHATSAPP_TEMPLATE' | 'ANALYTICS_EVENT' | 'NO_ACTION';
export const SUPPORTED_ACTIONS: readonly ActionFamily[] = [
  'INTERNAL_NOTIFICATION', 'CREATE_ADMIN_TASK', 'CREATE_FULFILMENT_TASK', 'CREATE_SUPPORT_TASK', 'EMAIL', 'WHATSAPP_TEMPLATE', 'ANALYTICS_EVENT', 'NO_ACTION',
];
const CUSTOMER_FACING: ReadonlySet<ActionFamily> = new Set(['EMAIL', 'WHATSAPP_TEMPLATE']);
export function isCustomerFacingAction(a: ActionFamily): boolean { return CUSTOMER_FACING.has(a); }
export function isSupportedAction(a: string): a is ActionFamily { return (SUPPORTED_ACTIONS as readonly string[]).includes(a); }

// ---------- audience + schedule + policies ----------
export type AudiencePolicyMode = 'SNAPSHOT_AT_PLAN' | 'REEVALUATE_AT_EXECUTION';
export type MisfirePolicy = 'SKIP' | 'RUN_ONCE';

export interface AutomationScheduleConfig {
  timezone: string;
  intervalMinutes: number;
  effectiveStart: Date | null;
  effectiveEnd: Date | null;
  misfirePolicy: MisfirePolicy;
}

export interface AutomationConditionConfig { conditionId: string; category: string; operator: string; expected: unknown; }
export interface AutomationActionConfig { actionIndex: number; family: ActionFamily; channel: string | null; config: Record<string, unknown>; }
export interface AutomationFrequencyConfig { perCustomerPerWindow: number | null; windowDays: number | null; global: boolean; countsAttempts: boolean; }

export interface AutomationVersionConfig {
  triggerFamily: TriggerFamily;
  triggerRef: string | null;
  audiencePolicyMode: AudiencePolicyMode;
  conditions: AutomationConditionConfig[];
  actions: AutomationActionConfig[];
  schedule: AutomationScheduleConfig | null;
  frequency: AutomationFrequencyConfig | null;
}

export type VersionValidationError =
  | 'UNSUPPORTED_ACTION'
  | 'NO_ACTIONS'
  | 'SCHEDULE_REQUIRED'
  | 'INVALID_INTERVAL'
  | 'INVALID_FREQUENCY_CAP'
  | 'INVALID_FREQUENCY_WINDOW';

/** Validate a version's config before it can be submitted for review. */
export function validateVersionConfig(cfg: AutomationVersionConfig): { ok: true; requiresApproval: boolean } | { ok: false; code: VersionValidationError } {
  if (!cfg.actions.length) return { ok: false, code: 'NO_ACTIONS' };
  for (const a of cfg.actions) if (!isSupportedAction(a.family)) return { ok: false, code: 'UNSUPPORTED_ACTION' };
  if (cfg.triggerFamily === 'SCHEDULED') {
    if (!cfg.schedule) return { ok: false, code: 'SCHEDULE_REQUIRED' };
    if (cfg.schedule.intervalMinutes <= 0) return { ok: false, code: 'INVALID_INTERVAL' };
  }
  if (cfg.frequency) {
    if (cfg.frequency.perCustomerPerWindow !== null && cfg.frequency.perCustomerPerWindow <= 0) {
      return { ok: false, code: 'INVALID_FREQUENCY_CAP' };
    }
    if (cfg.frequency.windowDays !== null && cfg.frequency.windowDays <= 0) {
      return { ok: false, code: 'INVALID_FREQUENCY_WINDOW' };
    }
  }
  const requiresApproval = cfg.actions.some((a) => isCustomerFacingAction(a.family));
  return { ok: true, requiresApproval };
}

/** A version's config is mutable only while the definition/version is not yet approved. */
export function isVersionMutable(defStatus: DefinitionStatus, approvalStatus: ApprovalStatus): boolean {
  if (approvalStatus === 'APPROVED') return false;
  return defStatus === 'DRAFT' || defStatus === 'READY_FOR_REVIEW' || defStatus === 'REJECTED';
}

/** Activation requires a valid version-scoped approval whenever approval is required. */
export function canActivate(input: { requiresApproval: boolean; approval: ApprovalSnapshot; now: Date }): { ok: true } | { ok: false; code: 'APPROVAL_REQUIRED' | 'APPROVAL_EXPIRED' } {
  if (!input.requiresApproval) return { ok: true };
  if (input.approval.status === 'EXPIRED' || (input.approval.status === 'APPROVED' && !isApprovalValid(input.approval, input.now))) return { ok: false, code: 'APPROVAL_EXPIRED' };
  if (!isApprovalValid(input.approval, input.now)) return { ok: false, code: 'APPROVAL_REQUIRED' };
  return { ok: true };
}

// ---------- schedule maths (pure, injectable now) ----------
export function computeNextRun(schedule: AutomationScheduleConfig, from: Date): Date | null {
  const next = new Date(from.getTime() + schedule.intervalMinutes * 60_000);
  if (schedule.effectiveEnd && next.getTime() > schedule.effectiveEnd.getTime()) return null;
  return next;
}
/** Misfire handling: SKIP realigns to the next slot; RUN_ONCE fires exactly one catch-up. */
export function resolveMisfire(schedule: AutomationScheduleConfig, expectedRun: Date, now: Date): { action: 'RUN' | 'SKIP'; nextRun: Date | null } {
  const overdueBy = now.getTime() - expectedRun.getTime();
  const late = overdueBy > schedule.intervalMinutes * 60_000;
  if (!late) return { action: 'RUN', nextRun: computeNextRun(schedule, expectedRun) };
  if (schedule.misfirePolicy === 'RUN_ONCE') return { action: 'RUN', nextRun: computeNextRun(schedule, now) };
  return { action: 'SKIP', nextRun: computeNextRun(schedule, now) };
}

// ---------- condition evaluation (pure, evidence-producing) ----------
export interface ConditionContext {
  lifecycleStage: string | null;
  consentEligible: boolean | null;
  identityConfidence: string | null;
  now: Date;
}
export interface ConditionEvidence {
  conditionId: string;
  category: string;
  operator: string;
  expected: unknown;
  inputValue: unknown;
  result: boolean;
  source: string;
  freshnessOk: boolean;
}
export interface ConditionsOutcome { allPassed: boolean; evidence: ConditionEvidence[] }

// ---------- execution eligibility (fixed fail-closed order) ----------
export const AUTOMATION_SUPPRESSION_REASONS = [
  'DEFINITION_PAUSED',
  'APPROVAL_REQUIRED',
  'SUBJECT_REQUIRED',
  'NO_PROFILE',
  'NO_DATA',
  'IDENTITY_CONFLICT',
  'STALE_PROFILE',
  'NO_CONSENT',
  'AUDIENCE_INELIGIBLE',
  'CONDITION_FAILED',
  'FREQUENCY_CAPPED',
] as const;
export type AutomationSuppressionReason = (typeof AUTOMATION_SUPPRESSION_REASONS)[number];

export type AutomationAudienceGateOutcome =
  | 'ELIGIBLE'
  | 'INELIGIBLE'
  | 'NO_PROFILE'
  | 'NO_CONSENT'
  | 'STALE_PROFILE'
  | 'IDENTITY_CONFLICT'
  | 'NO_DATA';

export interface AutomationEligibilityGateInput {
  definitionPaused: boolean;
  requiresApproval: boolean;
  approvalValid: boolean;
  subjectId: string | null;
  audienceOutcome: AutomationAudienceGateOutcome | null;
  consentEligible: boolean | null;
  conditionsPassed: boolean;
}

export type AutomationEligibilityGateResult =
  | { eligible: true; suppressionReason: null }
  | { eligible: false; suppressionReason: Exclude<AutomationSuppressionReason, 'FREQUENCY_CAPPED'> };

/**
 * Evaluate non-provider execution gates in one stable, fail-closed order.
 * Frequency is reserved transactionally after this pure decision succeeds.
 */
export function evaluateAutomationEligibility(input: AutomationEligibilityGateInput): AutomationEligibilityGateResult {
  if (input.definitionPaused) return { eligible: false, suppressionReason: 'DEFINITION_PAUSED' };
  if (input.requiresApproval && !input.approvalValid) return { eligible: false, suppressionReason: 'APPROVAL_REQUIRED' };
  if (!input.subjectId) return { eligible: false, suppressionReason: 'SUBJECT_REQUIRED' };
  if (input.audienceOutcome === 'NO_PROFILE') return { eligible: false, suppressionReason: 'NO_PROFILE' };
  if (input.audienceOutcome === 'NO_DATA' || input.audienceOutcome === null) return { eligible: false, suppressionReason: 'NO_DATA' };
  if (input.audienceOutcome === 'IDENTITY_CONFLICT') return { eligible: false, suppressionReason: 'IDENTITY_CONFLICT' };
  if (input.audienceOutcome === 'STALE_PROFILE') return { eligible: false, suppressionReason: 'STALE_PROFILE' };
  if (input.audienceOutcome === 'NO_CONSENT' || input.consentEligible !== true) return { eligible: false, suppressionReason: 'NO_CONSENT' };
  if (input.audienceOutcome !== 'ELIGIBLE') return { eligible: false, suppressionReason: 'AUDIENCE_INELIGIBLE' };
  if (!input.conditionsPassed) return { eligible: false, suppressionReason: 'CONDITION_FAILED' };
  return { eligible: true, suppressionReason: null };
}

/** Evaluate a version's conditions against a subject context, producing evidence. */
export function evaluateConditions(conditions: AutomationConditionConfig[], ctx: ConditionContext): ConditionsOutcome {
  const evidence: ConditionEvidence[] = [];
  for (const c of conditions) {
    let inputValue: unknown = null;
    let source = c.category;
    let result = false;
    if (c.category === 'lifecycle') { inputValue = ctx.lifecycleStage; source = 'customer_profiles'; result = c.operator === 'equals' ? ctx.lifecycleStage === c.expected : c.operator === 'not_equals' ? ctx.lifecycleStage !== c.expected : false; }
    else if (c.category === 'consent') { inputValue = ctx.consentEligible; source = 'consent'; result = ctx.consentEligible === c.expected; }
    else { inputValue = null; result = false; }
    evidence.push({ conditionId: c.conditionId, category: c.category, operator: c.operator, expected: c.expected, inputValue, result, source, freshnessOk: true });
  }
  return { allPassed: evidence.every((e) => e.result), evidence };
}

// ---------- idempotency keys ----------
export function buildTriggerExecutionKey(automationId: string, version: number, triggerEventId: string): string {
  return `automation:${automationId}:v${version}:trigger:${triggerEventId}`;
}
export function buildActionIdempotencyKey(automationId: string, version: number, subjectId: string, windowKey: string, actionIndex: number): string {
  return `automation:${automationId}:v${version}:subject:${subjectId}:window:${windowKey}:action:${actionIndex}`;
}
