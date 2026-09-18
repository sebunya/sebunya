/**
 * Action Center: proposals move through an explicit, audited lifecycle.
 * Machine actors (agents, workers, API keys) may PROPOSE and PREPARE; only a
 * human with the approve permission may APPROVE, and nobody approves their own
 * proposal. Publishing and destructive actions always need approval.
 */
export type ActionStatus =
  | 'DRAFT' | 'AWAITING_APPROVAL' | 'APPROVED' | 'REJECTED' | 'EXECUTING'
  | 'COMPLETED' | 'FAILED' | 'VERIFICATION_PENDING' | 'VERIFIED' | 'NOT_VERIFIED' | 'CANCELLED';

export type ActionCategory =
  | 'CONTENT_CHANGE' | 'METADATA_CHANGE' | 'SCHEMA_CHANGE' | 'INTERNAL_LINK_CHANGE' | 'CODE_CHANGE'
  | 'QUERY_TRACKING_CHANGE' | 'COMPETITOR_TRACKING_CHANGE' | 'MEASUREMENT_RUN' | 'INDEXING_SUBMISSION'
  | 'REPORT_GENERATION' | 'OTHER';

/** READ < MEASURE < CONFIGURE < EDIT < PUBLISH < DESTRUCTIVE */
export type RiskClass = 'MEASURE' | 'CONFIGURE' | 'EDIT' | 'PUBLISH' | 'DESTRUCTIVE';

export type ActorKind = 'USER' | 'SYSTEM' | 'AGENT' | 'SCHEDULER' | 'API_KEY' | 'WEBHOOK';

export const RISK_OF: Record<ActionCategory, RiskClass> = {
  MEASUREMENT_RUN: 'MEASURE', REPORT_GENERATION: 'MEASURE',
  QUERY_TRACKING_CHANGE: 'CONFIGURE', COMPETITOR_TRACKING_CHANGE: 'CONFIGURE',
  CONTENT_CHANGE: 'EDIT', METADATA_CHANGE: 'EDIT', SCHEMA_CHANGE: 'EDIT', INTERNAL_LINK_CHANGE: 'EDIT', CODE_CHANGE: 'EDIT',
  INDEXING_SUBMISSION: 'PUBLISH', OTHER: 'EDIT',
};

const NEXT: Record<ActionStatus, readonly ActionStatus[]> = {
  DRAFT: ['AWAITING_APPROVAL', 'CANCELLED'],
  AWAITING_APPROVAL: ['APPROVED', 'REJECTED', 'CANCELLED'],
  APPROVED: ['EXECUTING', 'COMPLETED', 'CANCELLED'],
  EXECUTING: ['COMPLETED', 'FAILED'],
  COMPLETED: ['VERIFICATION_PENDING'],
  FAILED: ['AWAITING_APPROVAL', 'CANCELLED'],
  VERIFICATION_PENDING: ['VERIFIED', 'NOT_VERIFIED'],
  REJECTED: [], VERIFIED: [], NOT_VERIFIED: [], CANCELLED: [],
};

export function canMove(from: ActionStatus, to: ActionStatus): boolean {
  return NEXT[from].includes(to);
}

export type ApprovalDecision = { ok: true } | { ok: false; reason: string };

export function mayApprove(input: { approverKind: ActorKind; approverId: string; proposerId: string | null; status: ActionStatus }): ApprovalDecision {
  if (input.status !== 'AWAITING_APPROVAL') return { ok: false, reason: `Only an action awaiting approval can be approved (this one is ${input.status}).` };
  if (input.approverKind !== 'USER') return { ok: false, reason: 'Only a person can approve an action; agents and keys may only propose.' };
  if (input.proposerId && input.proposerId === input.approverId) return { ok: false, reason: 'The person who proposed an action cannot approve it (four eyes).' };
  return { ok: true };
}

/** Whether an action may be marked executed by this actor. */
export function mayExecute(input: { status: ActionStatus; risk: RiskClass; actorKind: ActorKind }): ApprovalDecision {
  if (input.status !== 'APPROVED') return { ok: false, reason: 'An action runs only after it has been approved.' };
  if ((input.risk === 'PUBLISH' || input.risk === 'DESTRUCTIVE') && input.actorKind !== 'USER') {
    return { ok: false, reason: 'Publishing and destructive actions are carried out by a person, never an agent.' };
  }
  return { ok: true };
}

/** Before/after verification outcome — before/after only, so never causal. */
export function verificationVerdict(baseline: { cited: number; eligible: number }, after: { cited: number; eligible: number }): { status: 'VERIFIED' | 'NOT_VERIFIED'; summary: string } {
  if (after.eligible === 0) return { status: 'NOT_VERIFIED', summary: 'No citation-capable answers were collected after the change; nothing can be concluded.' };
  const b = baseline.eligible ? baseline.cited / baseline.eligible : 0;
  const a = after.cited / after.eligible;
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  return a > b
    ? { status: 'VERIFIED', summary: `Citation rate for the targeted queries went from ${pct(b)} to ${pct(a)} after the change. This is a before/after comparison: it shows the change and the improvement coincide, not that one caused the other.` }
    : { status: 'NOT_VERIFIED', summary: `Citation rate for the targeted queries went from ${pct(b)} to ${pct(a)}; no improvement was observed in this window.` };
}
