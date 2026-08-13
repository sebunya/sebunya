/**
 * SEO work queue (migration 0120) — the chain that turns an observation into a
 * measured outcome:
 *
 *   observation -> gap -> opportunity -> WORK ITEM -> change -> validation -> outcome
 *
 * The work item is the link that was missing. Without it, "opportunity" is a
 * list nobody owns and no change is ever traced back to the evidence that
 * justified it or forward to whether it worked.
 *
 * The rule that gives the queue its integrity: an item cannot reach DONE
 * without a MEASURED outcome. Shipping is not succeeding. "We changed the
 * title tags" is an activity; "rankings for these queries improved / did not
 * move / got worse" is a result, and NOT_MEASURED is an honest answer that
 * still closes the item — it just never masquerades as a win.
 */

export const WORK_ITEM_STATES = [
  'BACKLOG', 'READY', 'IN_PROGRESS', 'BLOCKED', 'SHIPPED', 'VALIDATING', 'DONE', 'ABANDONED',
] as const;
export type WorkItemState = (typeof WORK_ITEM_STATES)[number];

export const WORK_ITEM_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
export type WorkItemPriority = (typeof WORK_ITEM_PRIORITIES)[number];

export const WORK_ITEM_OUTCOMES = ['IMPROVED', 'NO_CHANGE', 'REGRESSED', 'INCONCLUSIVE', 'NOT_MEASURED'] as const;
export type WorkItemOutcome = (typeof WORK_ITEM_OUTCOMES)[number];

/** Legal state moves. Anything else is refused rather than silently allowed. */
const TRANSITIONS: Record<WorkItemState, WorkItemState[]> = {
  BACKLOG: ['READY', 'ABANDONED'],
  READY: ['IN_PROGRESS', 'BLOCKED', 'BACKLOG', 'ABANDONED'],
  IN_PROGRESS: ['SHIPPED', 'BLOCKED', 'READY', 'ABANDONED'],
  BLOCKED: ['READY', 'IN_PROGRESS', 'ABANDONED'],
  SHIPPED: ['VALIDATING', 'IN_PROGRESS'],
  VALIDATING: ['DONE', 'IN_PROGRESS'],
  DONE: [],
  ABANDONED: ['BACKLOG'],
};

export const allowedTransitionsFrom = (state: WorkItemState): WorkItemState[] => TRANSITIONS[state] ?? [];

export interface WorkItemInput {
  id?: string;
  title: string;
  detail?: string | null;
  state?: WorkItemState | string;
  priority?: WorkItemPriority | string;
  opportunityId?: string | null;
  gapId?: string | null;
  observationId?: string | null;
  changeLedgerId?: string | null;
  targetUrl?: string | null;
  assigneeId?: string | null;
  outcome?: WorkItemOutcome | string | null;
  outcomeNote?: string | null;
}

export type WorkItemValidation =
  | { ok: true; input: WorkItemInput & { state: WorkItemState; priority: WorkItemPriority } }
  | { ok: false; code: string; message: string };

/** Whether an item is traceable back to recorded evidence. */
export const hasEvidenceLink = (i: WorkItemInput): boolean =>
  Boolean(i.opportunityId || i.gapId || i.observationId);

export function validateWorkItem(raw: WorkItemInput, current?: { state?: string }): WorkItemValidation {
  const title = (raw.title ?? '').trim();
  if (!title) return { ok: false, code: 'BAD_INPUT', message: 'A work item needs a title.' };

  const state = (raw.state ?? 'BACKLOG') as WorkItemState;
  const priority = (raw.priority ?? 'MEDIUM') as WorkItemPriority;
  if (!WORK_ITEM_STATES.includes(state)) {
    return { ok: false, code: 'BAD_INPUT', message: `state must be one of ${WORK_ITEM_STATES.join(', ')}.` };
  }
  if (!WORK_ITEM_PRIORITIES.includes(priority)) {
    return { ok: false, code: 'BAD_INPUT', message: `priority must be one of ${WORK_ITEM_PRIORITIES.join(', ')}.` };
  }
  if (raw.outcome != null && raw.outcome !== '' && !WORK_ITEM_OUTCOMES.includes(raw.outcome as WorkItemOutcome)) {
    return { ok: false, code: 'BAD_INPUT', message: `outcome must be one of ${WORK_ITEM_OUTCOMES.join(', ')}.` };
  }

  // State machine: only enforced when we know where the item is coming from.
  const from = current?.state as WorkItemState | undefined;
  if (from && from !== state && !allowedTransitionsFrom(from).includes(state)) {
    return {
      ok: false,
      code: 'ILLEGAL_TRANSITION',
      message: `${from} cannot move to ${state}. Allowed from ${from}: ${allowedTransitionsFrom(from).join(', ') || 'nothing — it is terminal'}.`,
    };
  }

  // The integrity rule: DONE demands a measured result.
  if (state === 'DONE' && !raw.outcome) {
    return {
      ok: false,
      code: 'OUTCOME_REQUIRED',
      message: 'A work item cannot be DONE without a recorded outcome. If the effect was never measured, record NOT_MEASURED — shipping is not the same as succeeding.',
    };
  }
  if (raw.outcome === 'IMPROVED' && !(raw.outcomeNote ?? '').trim()) {
    return {
      ok: false,
      code: 'EVIDENCE_REQUIRED',
      message: 'Claiming IMPROVED requires a note saying what was measured and over what period.',
    };
  }

  return {
    ok: true,
    input: {
      ...raw,
      title,
      state,
      priority,
      detail: (raw.detail ?? '')?.trim() || null,
      outcome: (raw.outcome as WorkItemOutcome) || null,
      outcomeNote: (raw.outcomeNote ?? '')?.trim() || null,
    },
  };
}

export interface WorkQueueSummary {
  total: number;
  byState: Record<string, number>;
  /** Items with no link back to an observation, gap or opportunity. */
  unevidenced: number;
  /** Shipped or validating items whose effect has not been measured yet. */
  awaitingValidation: number;
  /** Of completed items, how many actually improved anything. */
  completed: number;
  improved: number;
  /** null when nothing is completed yet — never 0%, which would read as failure. */
  improvementRate: number | null;
}

export function summariseWorkQueue(
  items: Array<{ state?: string; outcome?: string | null; opportunityId?: string | null; gapId?: string | null; observationId?: string | null }>,
): WorkQueueSummary {
  const byState: Record<string, number> = {};
  for (const state of WORK_ITEM_STATES) byState[state] = 0;
  for (const i of items) byState[String(i.state ?? 'BACKLOG')] = (byState[String(i.state ?? 'BACKLOG')] ?? 0) + 1;

  const completed = items.filter((i) => i.state === 'DONE');
  const improved = completed.filter((i) => i.outcome === 'IMPROVED').length;
  return {
    total: items.length,
    byState,
    unevidenced: items.filter((i) => !hasEvidenceLink(i as WorkItemInput)).length,
    awaitingValidation: items.filter((i) => (i.state === 'SHIPPED' || i.state === 'VALIDATING') && !i.outcome).length,
    completed: completed.length,
    improved,
    // No completed work means the rate is unknown, not zero.
    improvementRate: completed.length === 0 ? null : improved / completed.length,
  };
}

/**
 * Promote an opportunity into a work item, carrying its evidence links so the
 * chain stays traceable. It is a draft in BACKLOG — promotion is not a
 * decision to do the work.
 */
export function workItemFromOpportunity(opp: {
  id?: string;
  title?: string;
  summary?: string | null;
  queryId?: string | null;
  gapId?: string | null;
  targetPath?: string | null;
  priority?: string | null;
}): WorkItemInput {
  return {
    title: (opp.title ?? '').trim() || 'Untitled opportunity',
    detail: opp.summary ?? null,
    state: 'BACKLOG',
    priority: (WORK_ITEM_PRIORITIES as readonly string[]).includes(String(opp.priority)) ? (opp.priority as WorkItemPriority) : 'MEDIUM',
    opportunityId: opp.id ?? null,
    gapId: opp.gapId ?? null,
    observationId: null,
    targetUrl: opp.targetPath ?? null,
  };
}
