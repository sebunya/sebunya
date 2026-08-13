/**
 * Portfolio logic: root-cause consolidation, decay, and the remediation
 * executor contract.
 *
 * This is what separates a decision system from a recommendation factory.
 * Twenty thin product pages caused by one missing spec-ingestion rule are ONE
 * problem, not twenty tasks. An opportunity whose product was discontinued is
 * not a backlog item, it is noise. And nothing reaches production without a
 * complete, policy-checked, reversible action request.
 */

import type { ActionClass, Confidence, Effort, Risk } from './OrganicOpportunityScoring';

// ── Root-cause consolidation ────────────────────────────────────────────────

export const ROOT_CAUSE_KINDS = [
  'TEMPLATE_DEFECT', 'MISSING_INGESTION_RULE', 'MISSING_LINK_RULE', 'CANONICAL_TEMPLATE',
  'METADATA_TEMPLATE', 'SCHEMA_TEMPLATE', 'CATALOGUE_GAP', 'LIFECYCLE_POLICY', 'INDEPENDENT',
] as const;
export type RootCauseKind = (typeof ROOT_CAUSE_KINDS)[number];

export interface OpportunitySymptom {
  opportunityId: string;
  entity: string;
  /** Where in the site this lives — template/route family, not a single URL. */
  templateFamily: string | null;
  actionClass: ActionClass;
  reasonCodes: string[];
  score: number;
}

export interface RootCauseGroup {
  rootCauseKind: RootCauseKind;
  key: string;
  /** The single intervention that unlocks the members. */
  interventionSummary: string;
  memberIds: string[];
  memberCount: number;
  /** Combined score of everything this one fix unblocks. */
  unlockedScore: number;
}

/** Below this, symptoms are genuinely independent rather than systemic. */
export const CONSOLIDATION_THRESHOLD = 3;

const CAUSE_BY_ACTION: Partial<Record<ActionClass, RootCauseKind>> = {
  REGENERATE_SCHEMA_FROM_TRUTH: 'SCHEMA_TEMPLATE',
  REFRESH_METADATA_FROM_TRUTH: 'METADATA_TEMPLATE',
  FIX_INTERNAL_LINK: 'MISSING_LINK_RULE',
  CANONICAL_CHANGE: 'CANONICAL_TEMPLATE',
  EXPAND_CATALOGUE: 'CATALOGUE_GAP',
  IMPROVE_CONTENT: 'MISSING_INGESTION_RULE',
};

/**
 * Groups symptoms that share a template family AND an action class. Below the
 * threshold they stay independent — over-consolidating is as wrong as
 * fragmenting, because it hides genuinely separate work behind one ticket.
 */
export function consolidateRootCauses(symptoms: OpportunitySymptom[]): {
  groups: RootCauseGroup[];
  independent: OpportunitySymptom[];
} {
  const buckets = new Map<string, OpportunitySymptom[]>();
  const independent: OpportunitySymptom[] = [];

  for (const s of symptoms) {
    if (!s.templateFamily) { independent.push(s); continue; }
    const key = `${s.templateFamily}::${s.actionClass}`;
    const list = buckets.get(key);
    if (list) list.push(s);
    else buckets.set(key, [s]);
  }

  const groups: RootCauseGroup[] = [];
  for (const [key, members] of buckets) {
    if (members.length < CONSOLIDATION_THRESHOLD) { independent.push(...members); continue; }
    const [templateFamily, actionClass] = key.split('::');
    const kind = CAUSE_BY_ACTION[actionClass as ActionClass] ?? 'TEMPLATE_DEFECT';
    groups.push({
      rootCauseKind: kind,
      key,
      interventionSummary:
        `${members.length} pages in ${templateFamily} share one cause: ${kind}. ` +
        `A single ${actionClass} at the template level resolves all of them.`,
      memberIds: members.map((m) => m.opportunityId),
      memberCount: members.length,
      unlockedScore: Number(members.reduce((n, m) => n + m.score, 0).toFixed(2)),
    });
  }

  return {
    groups: groups.sort((a, b) => b.unlockedScore - a.unlockedScore),
    independent,
  };
}

// ── Decay ───────────────────────────────────────────────────────────────────

export const DECAY_OUTCOMES = ['KEEP', 'DOWNGRADE', 'CLOSE_RESOLVED', 'CLOSE_OBSOLETE', 'CLOSE_SUPERSEDED'] as const;
export type DecayOutcome = (typeof DECAY_OUTCOMES)[number];

export interface DecayInput {
  /** Runs since the supporting evidence was last confirmed. */
  observationsSinceEvidence: number;
  demandDisappeared: boolean;
  productPermanentlyUnavailable: boolean;
  issueResolved: boolean;
  supersededByOpportunityId: string | null;
  preferredPageChanged: boolean;
  commercialPriorityDropped: boolean;
}

export interface DecayResult {
  outcome: DecayOutcome;
  reason: string;
}

/** Evidence older than this many observations is treated as stale. */
export const EVIDENCE_STALE_AFTER = 8;

export function assessDecay(i: DecayInput): DecayResult {
  if (i.issueResolved) return { outcome: 'CLOSE_RESOLVED', reason: 'The underlying issue no longer exists.' };
  if (i.supersededByOpportunityId) {
    return { outcome: 'CLOSE_SUPERSEDED', reason: `Superseded by ${i.supersededByOpportunityId}, which addresses the same cause.` };
  }
  if (i.productPermanentlyUnavailable) {
    return { outcome: 'CLOSE_OBSOLETE', reason: 'The product is permanently unavailable; investing in this page cannot pay back.' };
  }
  if (i.demandDisappeared) return { outcome: 'CLOSE_OBSOLETE', reason: 'The search demand this depended on is gone.' };
  if (i.preferredPageChanged) return { outcome: 'DOWNGRADE', reason: 'A different page should now own this demand; the opportunity must be re-derived.' };
  if (i.commercialPriorityDropped) return { outcome: 'DOWNGRADE', reason: 'Commercial priority for this area has fallen.' };
  if (i.observationsSinceEvidence >= EVIDENCE_STALE_AFTER) {
    return { outcome: 'DOWNGRADE', reason: `Evidence has not been confirmed for ${i.observationsSinceEvidence} observations.` };
  }
  return { outcome: 'KEEP', reason: 'Evidence remains current and the opportunity still stands.' };
}

// ── Remediation executor contract ───────────────────────────────────────────

export const EXECUTOR_OUTCOMES = [
  'ACCEPTED', 'DENIED', 'DEFERRED', 'EXECUTED', 'FAILED', 'VERIFICATION_PENDING', 'VERIFIED', 'ROLLED_BACK',
] as const;
export type ExecutorOutcome = (typeof EXECUTOR_OUTCOMES)[number];

export const ROLLBACK_CLASSES = ['NONE_REQUIRED', 'AUTOMATIC', 'MANUAL', 'IRREVERSIBLE'] as const;
export type RollbackClass = (typeof ROLLBACK_CLASSES)[number];

export interface ActionRequest {
  actionClass: ActionClass;
  entityId: string;
  opportunityId: string;
  evidenceIds: string[];
  policyVersion: string;
  preconditions: string[];
  confidence: Confidence;
  idempotencyKey: string;
  blastRadius: number;
  expectedEffect: string;
  rollbackClass: RollbackClass;
  verificationPlan: string;
}

export interface ActionCatalogueEntry {
  actionClass: ActionClass;
  /** Highest autonomy this class may EVER reach. */
  autonomyMaxLevel: 0 | 1 | 2 | 3 | 4;
  reversibility: RollbackClass;
  blastRadiusDefault: number;
  requiredPreconditions: string[];
  verificationMethod: string;
  rollbackRequired: boolean;
}

/**
 * The versioned catalogue. Autonomy ceilings live here, per class, and the
 * destructive classes are capped below 4 permanently — no accumulation of
 * successful runs promotes a mass-noindex to autonomous.
 */
export const ACTION_CATALOGUE: ActionCatalogueEntry[] = [
  { actionClass: 'REFRESH_EVIDENCE', autonomyMaxLevel: 4, reversibility: 'NONE_REQUIRED', blastRadiusDefault: 0, requiredPreconditions: [], verificationMethod: 'EVIDENCE_TIMESTAMP_ADVANCED', rollbackRequired: false },
  { actionClass: 'CREATE_WORK_ITEM', autonomyMaxLevel: 4, reversibility: 'AUTOMATIC', blastRadiusDefault: 0, requiredPreconditions: ['OPPORTUNITY_MATERIAL'], verificationMethod: 'WORK_ITEM_EXISTS', rollbackRequired: false },
  { actionClass: 'REPRIORITISE_WORK', autonomyMaxLevel: 4, reversibility: 'AUTOMATIC', blastRadiusDefault: 0, requiredPreconditions: [], verificationMethod: 'PRIORITY_RECOMPUTED', rollbackRequired: false },
  { actionClass: 'RESUBMIT_APPROVED_SITEMAP', autonomyMaxLevel: 3, reversibility: 'NONE_REQUIRED', blastRadiusDefault: 1, requiredPreconditions: ['SITEMAP_ALREADY_APPROVED', 'SITEMAP_REACHABLE'], verificationMethod: 'PROVIDER_ACCEPTED_SUBMISSION', rollbackRequired: false },
  { actionClass: 'FIX_INTERNAL_LINK', autonomyMaxLevel: 3, reversibility: 'AUTOMATIC', blastRadiusDefault: 5, requiredPreconditions: ['TARGET_INDEXABLE', 'TARGET_NOT_REDIRECT', 'SOURCE_RELEVANT'], verificationMethod: 'LINK_PRESENT_AND_CRAWLABLE', rollbackRequired: true },
  { actionClass: 'REGENERATE_SCHEMA_FROM_TRUTH', autonomyMaxLevel: 3, reversibility: 'AUTOMATIC', blastRadiusDefault: 10, requiredPreconditions: ['CANONICAL_TRUTH_AVAILABLE', 'NO_UNVERIFIED_CLAIMS'], verificationMethod: 'STRUCTURED_DATA_MATCHES_PAGE_TRUTH', rollbackRequired: true },
  { actionClass: 'REFRESH_METADATA_FROM_TRUTH', autonomyMaxLevel: 2, reversibility: 'AUTOMATIC', blastRadiusDefault: 10, requiredPreconditions: ['CANONICAL_TRUTH_AVAILABLE'], verificationMethod: 'METADATA_MATCHES_TRUTH', rollbackRequired: true },
  { actionClass: 'IMPROVE_CONTENT', autonomyMaxLevel: 1, reversibility: 'MANUAL', blastRadiusDefault: 1, requiredPreconditions: ['FACTUAL_GROUNDING', 'EDITORIAL_APPROVAL'], verificationMethod: 'HUMAN_REVIEW', rollbackRequired: true },
  { actionClass: 'CREATE_CONTENT', autonomyMaxLevel: 1, reversibility: 'MANUAL', blastRadiusDefault: 1, requiredPreconditions: ['FACTUAL_GROUNDING', 'NO_DUPLICATE_INTENT', 'EDITORIAL_APPROVAL'], verificationMethod: 'HUMAN_REVIEW', rollbackRequired: true },
  { actionClass: 'EXPAND_CATALOGUE', autonomyMaxLevel: 0, reversibility: 'MANUAL', blastRadiusDefault: 0, requiredPreconditions: ['COMMERCIAL_DECISION'], verificationMethod: 'CATALOGUE_DEPTH_INCREASED', rollbackRequired: false },
  { actionClass: 'CLEAR_TECHNICAL_BLOCKER', autonomyMaxLevel: 2, reversibility: 'AUTOMATIC', blastRadiusDefault: 5, requiredPreconditions: ['BLOCKER_IDENTIFIED', 'FIX_DETERMINISTIC'], verificationMethod: 'BLOCKER_ABSENT_ON_RECRAWL', rollbackRequired: true },
  // Structural and destructive: never autonomous.
  { actionClass: 'CANONICAL_CHANGE', autonomyMaxLevel: 0, reversibility: 'MANUAL', blastRadiusDefault: 1, requiredPreconditions: ['HUMAN_APPROVAL', 'EVIDENCE_PERSISTENT'], verificationMethod: 'CANONICAL_HONOURED_ON_RECRAWL', rollbackRequired: true },
  { actionClass: 'REDIRECT_CHANGE', autonomyMaxLevel: 0, reversibility: 'MANUAL', blastRadiusDefault: 1, requiredPreconditions: ['HUMAN_APPROVAL', 'SUCCESSOR_EXISTS'], verificationMethod: 'REDIRECT_RESOLVES_AND_INDEXED', rollbackRequired: true },
  { actionClass: 'INDEXABILITY_CHANGE', autonomyMaxLevel: 0, reversibility: 'MANUAL', blastRadiusDefault: 1, requiredPreconditions: ['HUMAN_APPROVAL', 'GATES_SATISFIED'], verificationMethod: 'INDEXABILITY_CONFIRMED', rollbackRequired: true },
];

export const catalogueEntry = (a: ActionClass): ActionCatalogueEntry | undefined =>
  ACTION_CATALOGUE.find((e) => e.actionClass === a);

export type ExecutorDecision =
  | { outcome: 'ACCEPTED'; entry: ActionCatalogueEntry }
  | { outcome: 'DENIED' | 'DEFERRED'; code: string; reason: string };

/**
 * The gate every production change must pass. Deterministic and policy-driven
 * — no LLM authorises a write, and an incomplete request is refused rather
 * than defaulted.
 */
export function evaluateActionRequest(input: {
  request: Partial<ActionRequest>;
  earnedLevel: 0 | 1 | 2 | 3 | 4;
  satisfiedPreconditions: string[];
  writesEnabled: boolean;
  observeOnly: boolean;
}): ExecutorDecision {
  const r = input.request;

  if (!r.actionClass) return { outcome: 'DENIED', code: 'NO_ACTION_CLASS', reason: 'The request names no action class.' };
  const entry = catalogueEntry(r.actionClass);
  if (!entry) return { outcome: 'DENIED', code: 'UNKNOWN_ACTION_CLASS', reason: `${r.actionClass} is not in the action catalogue.` };

  // Completeness first: a request missing its evidence, key or rollback plan is
  // not a decision, it is a guess.
  const missing: string[] = [];
  if (!r.entityId) missing.push('entityId');
  if (!r.opportunityId) missing.push('opportunityId');
  if (!r.evidenceIds || r.evidenceIds.length === 0) missing.push('evidenceIds');
  if (!r.policyVersion) missing.push('policyVersion');
  if (!r.idempotencyKey) missing.push('idempotencyKey');
  if (r.blastRadius === undefined || r.blastRadius === null) missing.push('blastRadius');
  if (!r.verificationPlan) missing.push('verificationPlan');
  if (!r.rollbackClass) missing.push('rollbackClass');
  if (missing.length > 0) {
    return { outcome: 'DENIED', code: 'INCOMPLETE_REQUEST', reason: `Missing required field(s): ${missing.join(', ')}.` };
  }

  if (entry.rollbackRequired && r.rollbackClass === 'NONE_REQUIRED') {
    return { outcome: 'DENIED', code: 'ROLLBACK_REQUIRED', reason: `${r.actionClass} requires a rollback plan.` };
  }
  if (r.rollbackClass === 'IRREVERSIBLE') {
    return { outcome: 'DENIED', code: 'IRREVERSIBLE', reason: 'An irreversible action is never executed by the agent.' };
  }

  const unmet = (entry.requiredPreconditions ?? []).filter((p) => !input.satisfiedPreconditions.includes(p));
  if (unmet.length > 0) {
    return { outcome: 'DEFERRED', code: 'PRECONDITIONS_UNMET', reason: `Waiting on: ${unmet.join(', ')}.` };
  }

  if (input.observeOnly) return { outcome: 'DENIED', code: 'OBSERVE_ONLY', reason: 'The system is in observe-only mode.' };
  if (!input.writesEnabled) return { outcome: 'DENIED', code: 'WRITES_DISABLED', reason: 'Autonomous writes are switched off.' };

  if (entry.autonomyMaxLevel === 0) {
    return { outcome: 'DENIED', code: 'REQUIRES_HUMAN', reason: `${r.actionClass} always requires a human decision.` };
  }
  if (input.earnedLevel < entry.autonomyMaxLevel && input.earnedLevel < 2) {
    return { outcome: 'DEFERRED', code: 'INSUFFICIENT_AUTONOMY', reason: `This class is at level ${input.earnedLevel}; it must earn more before executing.` };
  }
  if ((r.blastRadius ?? 0) > entry.blastRadiusDefault * 3) {
    return { outcome: 'DENIED', code: 'BLAST_RADIUS_EXCEEDED', reason: `Blast radius ${r.blastRadius} far exceeds the ${entry.blastRadiusDefault} default for this class.` };
  }
  if (r.confidence === 'LOW') {
    return { outcome: 'DEFERRED', code: 'LOW_CONFIDENCE', reason: 'Low-confidence evidence does not justify a production change.' };
  }

  return { outcome: 'ACCEPTED', entry };
}

// ── Outcome model ───────────────────────────────────────────────────────────

export const OUTCOME_STATES = [
  'NOT_ACTIONED', 'ACTION_PENDING', 'ACTIONED', 'VERIFICATION_PENDING', 'TECHNICALLY_VERIFIED',
  'SEARCH_EFFECT_PENDING', 'POSITIVE_OUTCOME', 'NEUTRAL_OUTCOME', 'NEGATIVE_OUTCOME',
  'ROLLED_BACK', 'INSUFFICIENT_EVIDENCE',
] as const;
export type OutcomeState = (typeof OUTCOME_STATES)[number];

/**
 * Deploying is not succeeding. A technically verified change still has to wait
 * for search evidence before anyone may call it a win.
 */
export function advanceOutcome(i: {
  current: OutcomeState;
  actionExecuted: boolean;
  technicallyVerified: boolean;
  searchEvidenceAvailable: boolean;
  searchEffect: 'IMPROVED' | 'NO_CHANGE' | 'WORSE' | null;
  rolledBack: boolean;
}): OutcomeState {
  if (i.rolledBack) return 'ROLLED_BACK';
  if (!i.actionExecuted) return i.current === 'ACTION_PENDING' ? 'ACTION_PENDING' : 'NOT_ACTIONED';
  if (!i.technicallyVerified) return 'VERIFICATION_PENDING';
  if (!i.searchEvidenceAvailable) return 'SEARCH_EFFECT_PENDING';
  if (i.searchEffect === 'IMPROVED') return 'POSITIVE_OUTCOME';
  if (i.searchEffect === 'WORSE') return 'NEGATIVE_OUTCOME';
  if (i.searchEffect === 'NO_CHANGE') return 'NEUTRAL_OUTCOME';
  return 'INSUFFICIENT_EVIDENCE';
}
