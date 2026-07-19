/**
 * Customer DNA — Next-Best-Action engine (pure domain).
 *
 * Deterministic candidate eligibility, suppression, scoring and ranking. Consent,
 * channel, stock, compatibility, promotion validity, recent-purchase, support,
 * fraud, delivery/backorder context and frequency caps all gate candidates.
 * NO_ACTION is a valid, mandatory outcome. Nothing is invented — candidates and
 * their eligibility are supplied by the caller from real source systems.
 */

export type NbaActionType =
  | 'RECOMMEND_PRODUCT'
  | 'RESUME_CART'
  | 'COMPLETE_CHECKOUT'
  | 'PRODUCT_EDUCATION'
  | 'COMPATIBILITY_GUIDANCE'
  | 'SUPPORT_FOLLOW_UP'
  | 'DELIVERY_FOLLOW_UP'
  | 'BACK_IN_STOCK'
  | 'LOYALTY_ACTION'
  | 'RETENTION'
  | 'WIN_BACK'
  | 'SURVEY'
  | 'NO_ACTION';

export type NbaExclusionReason =
  | 'CONSENT_REQUIRED'
  | 'CHANNEL_INELIGIBLE'
  | 'OUT_OF_STOCK'
  | 'INCOMPATIBLE'
  | 'PROMOTION_INVALID'
  | 'RECENT_PURCHASE'
  | 'OPEN_SUPPORT_CASE'
  | 'FRAUD_HOLD'
  | 'FREQUENCY_CAPPED';

export interface NbaCandidate {
  actionType: Exclude<NbaActionType, 'NO_ACTION'>;
  /** Optional target (e.g. product id) — used for recent-purchase/stock/compat checks. */
  targetRef?: string | null;
  baseScore: number;
  reasonCodes: string[];
}

export interface NbaContext {
  consentEligible: boolean;
  /** Per-channel eligibility, e.g. { email: true, sms: false }. */
  channelEligible: Record<string, boolean>;
  /** The channel this decision would activate on. */
  activationChannel: string | null;
  openSupportCase: boolean;
  fraudHold: boolean;
  frequencyCapReached: boolean;
  recentPurchaseRefs: string[];
  /** Refs currently out of stock (candidate is excluded if its target is here). */
  outOfStockRefs: string[];
  /** Refs judged incompatible for this customer. */
  incompatibleRefs: string[];
  /** Refs whose promotion is invalid/expired. */
  invalidPromotionRefs: string[];
  policyVersion: number;
}

export interface EvaluatedCandidate extends NbaCandidate {
  eligible: boolean;
  exclusionReason: NbaExclusionReason | null;
  score: number;
}

export interface NbaDecision {
  selectedAction: NbaActionType;
  selectedTargetRef: string | null;
  reasonCodes: string[];
  candidates: EvaluatedCandidate[];
  policyVersion: number;
}

/** Channels that require consent before an action may activate on them. */
const CONSENT_REQUIRED_ACTIONS: ReadonlySet<NbaActionType> = new Set([
  'RECOMMEND_PRODUCT', 'RETENTION', 'WIN_BACK', 'SURVEY', 'LOYALTY_ACTION', 'BACK_IN_STOCK',
]);

/** Pure eligibility evaluation. Order of checks is fixed so results are deterministic. */
export function evaluateCandidate(candidate: NbaCandidate, ctx: NbaContext): EvaluatedCandidate {
  const exclude = (reason: NbaExclusionReason): EvaluatedCandidate => ({ ...candidate, eligible: false, exclusionReason: reason, score: 0 });

  if (ctx.fraudHold) return exclude('FRAUD_HOLD');
  if (ctx.openSupportCase && candidate.actionType !== 'SUPPORT_FOLLOW_UP') return exclude('OPEN_SUPPORT_CASE');
  if (CONSENT_REQUIRED_ACTIONS.has(candidate.actionType) && !ctx.consentEligible) return exclude('CONSENT_REQUIRED');
  if (ctx.activationChannel && CONSENT_REQUIRED_ACTIONS.has(candidate.actionType) && ctx.channelEligible[ctx.activationChannel] === false) {
    return exclude('CHANNEL_INELIGIBLE');
  }
  if (candidate.targetRef) {
    if (ctx.recentPurchaseRefs.includes(candidate.targetRef)) return exclude('RECENT_PURCHASE');
    if (ctx.outOfStockRefs.includes(candidate.targetRef)) return exclude('OUT_OF_STOCK');
    if (ctx.incompatibleRefs.includes(candidate.targetRef)) return exclude('INCOMPATIBLE');
    if (ctx.invalidPromotionRefs.includes(candidate.targetRef)) return exclude('PROMOTION_INVALID');
  }
  if (ctx.frequencyCapReached) return exclude('FREQUENCY_CAPPED');

  return { ...candidate, eligible: true, exclusionReason: null, score: candidate.baseScore };
}

/** Deterministic action priority for tie-breaking (lower = preferred). */
const ACTION_PRIORITY: NbaActionType[] = [
  'COMPLETE_CHECKOUT', 'RESUME_CART', 'DELIVERY_FOLLOW_UP', 'SUPPORT_FOLLOW_UP', 'BACK_IN_STOCK',
  'RECOMMEND_PRODUCT', 'COMPATIBILITY_GUIDANCE', 'PRODUCT_EDUCATION', 'WIN_BACK', 'RETENTION', 'LOYALTY_ACTION', 'SURVEY',
];

/**
 * Decide the next best action. Evaluates every candidate, keeps the eligible set,
 * ranks by score then deterministic priority then targetRef, and returns the
 * winner — or a truthful NO_ACTION when nothing is eligible.
 */
export function decideNextBestAction(candidates: NbaCandidate[], ctx: NbaContext): NbaDecision {
  const evaluated = candidates.map((c) => evaluateCandidate(c, ctx));
  const eligible = evaluated.filter((c) => c.eligible);

  if (eligible.length === 0) {
    return {
      selectedAction: 'NO_ACTION',
      selectedTargetRef: null,
      reasonCodes: ['NO_ELIGIBLE_ACTION'],
      candidates: evaluated,
      policyVersion: ctx.policyVersion,
    };
  }

  eligible.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const pa = ACTION_PRIORITY.indexOf(a.actionType);
    const pb = ACTION_PRIORITY.indexOf(b.actionType);
    if (pa !== pb) return pa - pb;
    return (a.targetRef ?? '').localeCompare(b.targetRef ?? '');
  });

  const winner = eligible[0];
  return {
    selectedAction: winner.actionType,
    selectedTargetRef: winner.targetRef ?? null,
    reasonCodes: winner.reasonCodes.length ? winner.reasonCodes : [`SELECTED_${winner.actionType}`],
    candidates: evaluated,
    policyVersion: ctx.policyVersion,
  };
}
