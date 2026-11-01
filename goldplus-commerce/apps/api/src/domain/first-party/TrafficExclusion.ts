/**
 * Historical exhaust exclusion (0155). Our own synthetic monitor, Lighthouse
 * Watch, post-deploy smoke tests and cookieless SSR page renders wrote most of
 * the rows in recommendation_events and experience_profiles (lineage audit
 * 2026-09-20). Those rows stay exactly as written; analysis reads the
 * analysis.*_human views, which leave out rows carrying an active MARK.
 *
 * A mark names the rule that made it and the run that wrote it, so any run
 * can be reverted (its marks get reverted_at; the rows come back into every
 * report). Nothing here deletes or updates a source row.
 */

export type ExclusionTable = 'recommendation_events' | 'experience_profiles';

export type ExclusionRuleKey =
  | 'AUTOMATED_USER_AGENT'
  | 'PROBE_MARKED'
  | 'RESPONSE_WITHOUT_VISITOR'
  | 'SINGLE_HIT_PROFILE'
  | 'EVENT_OF_EXCLUDED_PROFILE';

export interface ExclusionRule {
  key: ExclusionRuleKey;
  table: ExclusionTable;
  description: string;
  /** Included when the operator names no rules. */
  defaultOn: boolean;
  /** Must run after these (it reads their marks). */
  after: ExclusionRuleKey[];
}

export const EXCLUSION_RULES: readonly ExclusionRule[] = [
  {
    key: 'AUTOMATED_USER_AGENT',
    table: 'recommendation_events',
    description: 'Behaviour events whose browser is our own tooling: node (synthetic monitor and SSR fetches), Lighthouse, headless Chrome, Playwright.',
    defaultOn: true,
    after: [],
  },
  {
    key: 'PROBE_MARKED',
    table: 'recommendation_events',
    description: 'Events whose metadata says the traffic was automated or a gp_probe post-deploy smoke run.',
    defaultOn: true,
    after: [],
  },
  {
    key: 'SINGLE_HIT_PROFILE',
    table: 'experience_profiles',
    description: 'Visitor profiles seen exactly once (first seen = last seen within a second), never linked to a customer, with no order, basket or behaviour event: the profiles cookieless page renders and probes minted.',
    defaultOn: true,
    after: [],
  },
  {
    key: 'EVENT_OF_EXCLUDED_PROFILE',
    table: 'recommendation_events',
    description: 'Events recorded against a profile already excluded above.',
    defaultOn: true,
    after: ['SINGLE_HIT_PROFILE'],
  },
  {
    key: 'RESPONSE_WITHOUT_VISITOR',
    table: 'recommendation_events',
    description: 'Server-side RECOMMENDATION_RESPONSE log rows with no visitor, profile or customer. Behaviour reports already ignore this event type, and it is most of the table, so this rule is OFF unless named (marks cost about 120 bytes each).',
    defaultOn: false,
    after: [],
  },
];

/** Browser families that are our own tooling, never a shopper. */
export const AUTOMATED_BROWSER_PATTERNS = ['node%', '%lighthouse%', '%headless%', '%playwright%', 'undici%', 'curl%'];
/** metadata values set by our own probes and classifiers. */
export const AUTOMATED_TRAFFIC_CLASSES = ['automated', 'internal', 'probe', 'monitor'];

/** Approximate bytes one mark costs (heap tuple + primary key entry). */
export const BYTES_PER_MARK = 120;

export function resolveRuleSelection(names: string[] | null | undefined):
  | { ok: true; rules: ExclusionRule[] }
  | { ok: false; unknown: string[] } {
  const wanted = (names ?? []).map((n) => n.trim().toUpperCase()).filter(Boolean);
  if (wanted.length === 0) return { ok: true, rules: orderRules(EXCLUSION_RULES.filter((r) => r.defaultOn)) };
  const unknown = wanted.filter((w) => !EXCLUSION_RULES.some((r) => r.key === w));
  if (unknown.length) return { ok: false, unknown };
  return { ok: true, rules: orderRules(EXCLUSION_RULES.filter((r) => wanted.includes(r.key))) };
}

/** Dependencies first; otherwise the declared order. */
export function orderRules(rules: ExclusionRule[]): ExclusionRule[] {
  const keys = new Set(rules.map((r) => r.key));
  const out: ExclusionRule[] = [];
  const visit = (r: ExclusionRule) => {
    if (out.includes(r)) return;
    for (const dep of r.after) {
      const d = rules.find((x) => x.key === dep);
      if (d && keys.has(dep)) visit(d);
    }
    out.push(r);
  };
  rules.forEach(visit);
  return out;
}

export function estimateMarkBytes(count: number): number {
  return Math.max(0, count) * BYTES_PER_MARK;
}
