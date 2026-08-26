import {
  COMPAT_EVIDENCE_STATUSES,
  COMPAT_WORKFLOW_STATUSES,
  VERIFIED_EVIDENCE_STATUSES,
  PUBLIC_FIT_LABELS,
  type CompatEvidenceStatus,
  type CompatWorkflowStatus,
  type PublicFitState,
} from '@goldplus/shared';

/**
 * The compatibility claim lifecycle. Pure domain.
 *
 *   DRAFT --submit--> REVIEW --verify--> READY --publish--> ACTIVE --archive--> ARCHIVED
 *     ^                 |  reject                                        |  restore
 *     +-----------------+                                                +--> READY (if it was verified) or DRAFT
 *
 * Maker and checker are different people: whoever created or submitted the
 * claim cannot verify it. Only explicitly published (ACTIVE) claims can be
 * public, and only for a battery that is itself ACTIVE and approved.
 */

export type CompatAction = 'SUBMIT' | 'VERIFY' | 'REJECT' | 'PUBLISH' | 'UNPUBLISH' | 'ARCHIVE' | 'RESTORE' | 'REOPEN';

export interface CompatClaimState {
  workflowStatus: CompatWorkflowStatus;
  evidenceStatus: CompatEvidenceStatus;
  createdBy: string | null;
  submittedBy: string | null;
  reviewedBy: string | null;
  publicCondition: string | null;
  deviceStatus: string; // ACTIVE | ARCHIVED | MERGED
}

export type TransitionResult =
  | { ok: true; next: CompatWorkflowStatus; evidenceStatus: CompatEvidenceStatus }
  | { ok: false; code: 'INVALID_TRANSITION' | 'MAKER_CHECKER' | 'EVIDENCE_REQUIRED' | 'CONDITION_REQUIRED' | 'DEVICE_INVALID' | 'REJECTED'; message: string };

export function isEvidenceStatus(value: string): value is CompatEvidenceStatus {
  return (COMPAT_EVIDENCE_STATUSES as readonly string[]).includes(value);
}

export function isWorkflowStatus(value: string): value is CompatWorkflowStatus {
  return (COMPAT_WORKFLOW_STATUSES as readonly string[]).includes(value);
}

export function transitionClaim(
  state: CompatClaimState,
  action: CompatAction,
  actorId: string,
  detail: { evidenceStatus?: CompatEvidenceStatus; publicCondition?: string | null; reason?: string } = {},
): TransitionResult {
  const s = state.workflowStatus;
  const fail = (code: Extract<TransitionResult, { ok: false }>['code'], message: string): TransitionResult => ({ ok: false, code, message });

  switch (action) {
    case 'SUBMIT': {
      if (s !== 'DRAFT') return fail('INVALID_TRANSITION', `Only a draft claim can be submitted (this one is ${s}).`);
      if (state.deviceStatus !== 'ACTIVE') return fail('DEVICE_INVALID', 'The device is archived or merged; pick the current device first.');
      return { ok: true, next: 'REVIEW', evidenceStatus: state.evidenceStatus };
    }
    case 'VERIFY': {
      if (s !== 'REVIEW') return fail('INVALID_TRANSITION', `Only a claim in review can be verified (this one is ${s}).`);
      if (actorId === state.createdBy || actorId === state.submittedBy) {
        return fail('MAKER_CHECKER', 'The person who entered or submitted a claim cannot verify it. A second person must check the evidence.');
      }
      if (state.deviceStatus !== 'ACTIVE') return fail('DEVICE_INVALID', 'The device is archived or merged; the claim must be re-pointed before verification.');
      const evidence = detail.evidenceStatus ?? state.evidenceStatus;
      if (evidence === 'REJECTED') return fail('REJECTED', 'Use reject for a claim that does not fit.');
      if (evidence === 'SUPPLIER_LISTED') {
        return fail('EVIDENCE_REQUIRED', 'Verification needs evidence: package verified, fit tested or verified exact. A supplier listing alone stays awaiting verification.');
      }
      const condition = (detail.publicCondition ?? state.publicCondition ?? '').trim();
      if (evidence === 'CONDITIONAL' && !condition) return fail('CONDITION_REQUIRED', 'A conditional fit must state the customer-facing condition.');
      return { ok: true, next: 'READY', evidenceStatus: evidence };
    }
    case 'REJECT': {
      if (s !== 'REVIEW' && s !== 'READY') return fail('INVALID_TRANSITION', `Only a claim in review or ready can be rejected (this one is ${s}).`);
      if (actorId === state.createdBy || actorId === state.submittedBy) {
        return fail('MAKER_CHECKER', 'The person who entered or submitted a claim cannot decide on it.');
      }
      if (!(detail.reason ?? '').trim()) return fail('EVIDENCE_REQUIRED', 'A rejection needs a reason.');
      return { ok: true, next: 'ARCHIVED', evidenceStatus: 'REJECTED' };
    }
    case 'PUBLISH': {
      if (s !== 'READY') return fail('INVALID_TRANSITION', `Only a verified (ready) claim can be published (this one is ${s}).`);
      if (state.evidenceStatus === 'REJECTED') return fail('REJECTED', 'A rejected claim can never be published.');
      if (state.deviceStatus !== 'ACTIVE') return fail('DEVICE_INVALID', 'The device is archived or merged.');
      return { ok: true, next: 'ACTIVE', evidenceStatus: state.evidenceStatus };
    }
    case 'UNPUBLISH': {
      if (s !== 'ACTIVE') return fail('INVALID_TRANSITION', 'Only a live claim can be unpublished.');
      return { ok: true, next: 'READY', evidenceStatus: state.evidenceStatus };
    }
    case 'ARCHIVE': {
      if (s === 'ARCHIVED') return fail('INVALID_TRANSITION', 'The claim is already archived.');
      return { ok: true, next: 'ARCHIVED', evidenceStatus: state.evidenceStatus };
    }
    case 'RESTORE': {
      if (s !== 'ARCHIVED') return fail('INVALID_TRANSITION', 'Only an archived claim can be restored.');
      if (state.evidenceStatus === 'REJECTED') return fail('REJECTED', 'A rejected claim is restored as a new draft: reopen it and re-enter the evidence.');
      const verified = !!state.reviewedBy && state.evidenceStatus !== 'SUPPLIER_LISTED';
      return { ok: true, next: verified ? 'READY' : 'DRAFT', evidenceStatus: state.evidenceStatus };
    }
    case 'REOPEN': {
      if (s === 'DRAFT') return fail('INVALID_TRANSITION', 'The claim is already a draft.');
      // Reopening clears the verdict: evidence goes back to what a new entry can assert.
      const evidence: CompatEvidenceStatus = state.evidenceStatus === 'REJECTED' ? 'SUPPLIER_LISTED' : state.evidenceStatus;
      return { ok: true, next: 'DRAFT', evidenceStatus: evidence };
    }
    default:
      return fail('INVALID_TRANSITION', 'Unknown action.');
  }
}

/** Fields an editor may change without re-review; anything else reopens the claim. */
export const NON_MATERIAL_FIELDS = new Set(['notes', 'evidenceSource', 'evidenceType']);

export function isMaterialEdit(changedFields: string[]): boolean {
  return changedFields.some((f) => !NON_MATERIAL_FIELDS.has(f));
}

/** Map the workflow onto the 0070 `confidence` column so older readers stay truthful. */
export function legacyConfidence(evidence: CompatEvidenceStatus, workflow: CompatWorkflowStatus): 'verified' | 'inferred' | 'declared' {
  if (VERIFIED_EVIDENCE_STATUSES.includes(evidence) && (workflow === 'READY' || workflow === 'ACTIVE')) return 'verified';
  if (evidence === 'CONDITIONAL' && (workflow === 'READY' || workflow === 'ACTIVE')) return 'inferred';
  return 'declared';
}

export interface PublicFitInput {
  workflowStatus: CompatWorkflowStatus;
  evidenceStatus: CompatEvidenceStatus;
  batteryLifecycle: string; // battery_profiles.lifecycle_status
  productApproved: boolean;
  productActive: boolean;
  stockQuantity: number;
  showAwaitingVerification: boolean;
}

/**
 * What the customer may be told. `null` = not shown at all. Unverified is never
 * presented as confirmed; the evidence level and the stock level are separate
 * facts and are stated separately.
 */
export function publicFitState(input: PublicFitInput): PublicFitState | null {
  if (input.workflowStatus !== 'ACTIVE') return null;
  if (input.evidenceStatus === 'REJECTED') return null;
  if (input.batteryLifecycle !== 'ACTIVE') return null;
  if (!input.productApproved || !input.productActive) return null;
  if (VERIFIED_EVIDENCE_STATUSES.includes(input.evidenceStatus)) {
    return input.stockQuantity > 0 ? 'VERIFIED_IN_STOCK' : 'VERIFIED_OUT_OF_STOCK';
  }
  if (input.evidenceStatus === 'CONDITIONAL') return 'CONDITIONAL';
  if (input.evidenceStatus === 'SUPPLIER_LISTED') return input.showAwaitingVerification ? 'AWAITING_VERIFICATION' : null;
  return null;
}

export function publicFitLabel(state: PublicFitState): string {
  return PUBLIC_FIT_LABELS[state];
}

/** Rank public results: verified in stock, verified out of stock, conditional, awaiting. */
export function publicFitRank(state: PublicFitState): number {
  switch (state) {
    case 'VERIFIED_IN_STOCK': return 0;
    case 'VERIFIED_OUT_OF_STOCK': return 1;
    case 'CONDITIONAL': return 2;
    default: return 3;
  }
}
