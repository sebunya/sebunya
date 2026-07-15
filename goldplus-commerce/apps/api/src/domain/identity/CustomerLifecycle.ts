/**
 * Customer lifecycle + deterministic next-best-action (Slice 9). Pure domain.
 *
 * Principles:
 *  - The "unified profile" is the existing identity + orders + consent data —
 *    no second profile store exists or is created.
 *  - Stages derive only from real order history. No fabricated scores, no
 *    propensity models — every output carries its explanation.
 *  - Suppression-first: without explicit personalisation consent, the next
 *    best action is suppressed. Unknown consent is treated as no consent.
 *  - Actions are operator review suggestions. Nothing here sends anything.
 */

export type LifecycleStage = 'prospect' | 'new' | 'active' | 'at_risk' | 'dormant';

export interface LifecycleSignals {
  ordersCount: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
export const LIFECYCLE_THRESHOLDS = { newCustomerDays: 60, activeDays: 90, atRiskDays: 180 } as const;

export function lifecycleStage(signals: LifecycleSignals, now: Date): { stage: LifecycleStage; explanation: string } {
  if (signals.ordersCount === 0 || !signals.lastOrderAt) {
    return { stage: 'prospect', explanation: 'No completed orders yet.' };
  }
  const daysSinceLast = Math.floor((now.getTime() - signals.lastOrderAt.getTime()) / DAY_MS);
  if (
    signals.ordersCount === 1 &&
    signals.firstOrderAt &&
    now.getTime() - signals.firstOrderAt.getTime() <= LIFECYCLE_THRESHOLDS.newCustomerDays * DAY_MS
  ) {
    return { stage: 'new', explanation: `First and only order ${daysSinceLast} days ago (within ${LIFECYCLE_THRESHOLDS.newCustomerDays}-day onboarding window).` };
  }
  if (daysSinceLast <= LIFECYCLE_THRESHOLDS.activeDays) {
    return { stage: 'active', explanation: `Last order ${daysSinceLast} days ago (≤${LIFECYCLE_THRESHOLDS.activeDays}).` };
  }
  if (daysSinceLast <= LIFECYCLE_THRESHOLDS.atRiskDays) {
    return { stage: 'at_risk', explanation: `Last order ${daysSinceLast} days ago (${LIFECYCLE_THRESHOLDS.activeDays + 1}–${LIFECYCLE_THRESHOLDS.atRiskDays}).` };
  }
  return { stage: 'dormant', explanation: `Last order ${daysSinceLast} days ago (>${LIFECYCLE_THRESHOLDS.atRiskDays}).` };
}

export type ConsentState = 'granted' | 'denied' | 'unknown';

export interface NextBestAction {
  action: string;
  suppressed: boolean;
  explanation: string;
}

/** Deterministic stage→action map. Operator suggestions only — never a send. */
const STAGE_ACTIONS: Record<LifecycleStage, { action: string; explanation: string }> = {
  prospect: { action: 'review_first_purchase_barriers', explanation: 'Prospect with no orders: review catalogue visibility and checkout friction; no outreach.' },
  new: { action: 'onboarding_check_in_review', explanation: 'One recent order: operator may review onboarding experience and product verification guidance.' },
  active: { action: 'complete_the_set_review', explanation: 'Recent buyer: review verified compatibility/complete-the-set coverage for their purchases.' },
  at_risk: { action: 'win_back_review', explanation: 'Purchase gap growing: operator review for win-back eligibility once communications are approved.' },
  dormant: { action: 'no_contact_review', explanation: 'Long inactive: review before any re-engagement; respect consent and suppression.' },
};

export function nextBestAction(stage: LifecycleStage, consent: ConsentState): NextBestAction {
  if (consent !== 'granted') {
    return {
      action: 'suppressed',
      suppressed: true,
      explanation:
        consent === 'denied'
          ? 'Personalisation consent denied — all actions suppressed.'
          : 'Personalisation consent unknown — treated as not granted; all actions suppressed.',
    };
  }
  const mapped = STAGE_ACTIONS[stage];
  return { action: mapped.action, suppressed: false, explanation: mapped.explanation };
}
