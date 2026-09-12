import { createHash } from 'node:crypto';

/**
 * Stable semantic identity and change detection for organic intelligence.
 *
 * Identity is the load-bearing idea in this whole layer. An opportunity's key
 * must survive process restart, redeploy, policy rescoring, historical
 * backfill and provider activation — because the key is what its history,
 * its work item and its action record hang from. Derive it from a sequence, a
 * run id, a rank or a timestamp and every one of those links breaks the first
 * time anything changes.
 *
 * Three hashes are kept deliberately separate:
 *
 *   sourceHash      the evidence as observed. Moves only when reality moves.
 *   semanticHash    the meaning of the finding. Provider metadata churn (a
 *                   fetch timestamp, a row ordering) must NOT move it.
 *   evaluationHash  the scored result. A policy change moves this alone, so
 *                   "we changed the algorithm" stays permanently
 *                   distinguishable from "demand changed".
 *
 * Everything here is pure and deterministic.
 */

export const ENGINE_VERSION = '1.0.0';
export const MATERIALISATION_VERSION = 1;

const sha = (parts: unknown[]): string =>
  createHash('sha256').update(parts.map((p) => canonical(p)).join('\x00')).digest('hex').slice(0, 32);

/**
 * Canonical serialisation: object keys sorted, arrays sorted when they are
 * sets of scalars. Without this, two identical findings hash differently
 * purely because a query returned rows in another order.
 */
function canonical(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) {
    const parts = value.map((v) => canonical(v));
    const scalarSet = value.every((v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean');
    return `[${(scalarSet ? [...parts].sort() : parts).join(',')}]`;
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${k}:${canonical(v)}`).join(',')}}`;
  }
  return String(value);
}

const slug = (s: unknown): string =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9./:-]/g, '')
    .slice(0, 120) || 'unknown';

// ── Semantic keys ───────────────────────────────────────────────────────────

export type EntityType =
  | 'QUERY_CLUSTER' | 'URL' | 'PRODUCT' | 'PRODUCT_FAMILY' | 'CATEGORY'
  | 'COMPATIBILITY' | 'CONTENT' | 'TEMPLATE';

/**
 * An opportunity is identified by WHAT it is about and WHAT KIND of finding it
 * is — never by score, rank, run or wording. Two runs observing the same
 * problem on the same entity produce the same key, which is what makes
 * "update, don't duplicate" possible.
 */
export function opportunityKey(input: {
  opportunityClass: string;
  entityType: EntityType;
  entityId: string;
}): string {
  return `opp:${slug(input.opportunityClass)}:${slug(input.entityType)}:${slug(input.entityId)}`;
}

/** Cluster identity comes from the clustering engine and is passed through. */
export const clusterKey = (raw: string): string => `cl:${slug(raw)}`;

/**
 * An answer unit is identified by its SEMANTIC question, not its wording.
 * Rephrasing "Which battery fits X?" must not create a second unit.
 */
export function answerKey(input: { templateId: string; entityContext: string; answerType: string }): string {
  return `ans:${slug(input.templateId)}:${slug(input.answerType)}:${slug(input.entityContext)}`;
}

/** A root cause is a template family plus the intervention it needs. */
export function rootCauseKey(input: { templateFamily: string; actionClass: string }): string {
  return `rc:${slug(input.templateFamily)}:${slug(input.actionClass)}`;
}

// ── Hashes ──────────────────────────────────────────────────────────────────

/**
 * The observed evidence. Callers must pass only real measurements — NOT fetch
 * timestamps, run ids or row order, or every run looks like a change.
 */
export const sourceHash = (evidence: Record<string, unknown>): string => sha(['src', evidence]);

/** The meaning of the finding: readiness, blockers, decision. */
export const semanticHash = (meaning: Record<string, unknown>): string => sha(['sem', meaning]);

/** The scored result under a specific policy. */
export const evaluationHash = (input: { policyVersion: string; engineVersion: string; score: number | null; components: unknown }): string =>
  sha(['eval', input.policyVersion, input.engineVersion, input.score, input.components]);

/** Fact grounding for an answer unit; changes when any referenced fact changes. */
export const factHash = (factRefs: Array<{ key: string; sourceId: string; verified: boolean }>): string =>
  sha(['fact', factRefs.map((f) => ({ k: f.key, s: f.sourceId, v: f.verified }))]);

// ── Change classification ───────────────────────────────────────────────────

export const CHANGE_KINDS = [
  'UNCHANGED', 'CREATED', 'SOURCE_CHANGED', 'SEMANTIC_CHANGED',
  'POLICY_REEVALUATED', 'EVIDENCE_ENRICHED', 'EVIDENCE_INVALIDATED',
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

export interface StoredSnapshot {
  sourceHash: string;
  semanticHash: string;
  evaluationHash: string;
  policyVersion: string;
  evidenceAvailable: string[];
  score: number | null;
  priorityBucket: string;
}

export type ComputedSnapshot = StoredSnapshot;

/** Score movement below this is noise, not history. */
export const SCORE_MATERIALITY = 1.0;

export interface ChangeVerdict {
  kind: ChangeKind;
  /** Does this warrant a domain write at all? */
  writeRequired: boolean;
  /** Does this warrant a history event? */
  historyRequired: boolean;
  reason: string;
}

/**
 * The gate that keeps a six-hourly reconciliation from churning the database.
 * Ordered most-specific-first: enrichment and invalidation are recognised
 * before the generic "source changed", because "we can now see demand" is a
 * materially different event from "demand moved".
 */
export function classifyChange(prev: StoredSnapshot | null, next: ComputedSnapshot): ChangeVerdict {
  if (!prev) {
    return { kind: 'CREATED', writeRequired: true, historyRequired: true, reason: 'First observation of this opportunity.' };
  }

  const gainedEvidence = next.evidenceAvailable.filter((d) => !prev.evidenceAvailable.includes(d));
  const lostEvidence = prev.evidenceAvailable.filter((d) => !next.evidenceAvailable.includes(d));

  if (lostEvidence.length > 0) {
    return {
      kind: 'EVIDENCE_INVALIDATED',
      writeRequired: true,
      historyRequired: true,
      reason: `Evidence withdrawn: ${lostEvidence.join(', ')}. Confidence and readiness must fall accordingly.`,
    };
  }
  if (gainedEvidence.length > 0) {
    return {
      kind: 'EVIDENCE_ENRICHED',
      writeRequired: true,
      historyRequired: true,
      reason: `New evidence available: ${gainedEvidence.join(', ')}.`,
    };
  }

  const sourceMoved = prev.sourceHash !== next.sourceHash;
  const semanticMoved = prev.semanticHash !== next.semanticHash;
  const policyMoved = prev.policyVersion !== next.policyVersion;

  if (!sourceMoved && !semanticMoved && policyMoved) {
    // The world did not change; our judgement of it did. Recorded as such so
    // nobody later reads a rescoring as a demand shift.
    return {
      kind: 'POLICY_REEVALUATED',
      writeRequired: true,
      historyRequired: true,
      reason: `Rescored under policy ${next.policyVersion} (was ${prev.policyVersion}); underlying evidence unchanged.`,
    };
  }
  if (semanticMoved) {
    return { kind: 'SEMANTIC_CHANGED', writeRequired: true, historyRequired: true, reason: 'The meaning of the finding changed (readiness, blockers or decision).' };
  }
  if (sourceMoved) {
    const scoreDelta = Math.abs((next.score ?? 0) - (prev.score ?? 0));
    const priorityMoved = prev.priorityBucket !== next.priorityBucket;
    const material = priorityMoved || scoreDelta >= SCORE_MATERIALITY;
    return {
      kind: 'SOURCE_CHANGED',
      writeRequired: true,
      // A 78.20 -> 78.21 drift updates the row's freshness but writes no
      // history; otherwise the timeline fills with noise nobody can read.
      historyRequired: material,
      reason: material
        ? `Evidence moved materially (score ${prev.score ?? 'n/a'} → ${next.score ?? 'n/a'}${priorityMoved ? `, priority ${prev.priorityBucket} → ${next.priorityBucket}` : ''}).`
        : 'Evidence moved immaterially; freshness refreshed without a history event.',
    };
  }

  return {
    kind: 'UNCHANGED',
    // The invariant this whole design turns on: nothing changed, so nothing is
    // written beyond the run's own heartbeat.
    writeRequired: false,
    historyRequired: false,
    reason: 'No change in source, meaning, policy or evidence coverage.',
  };
}

// ── Evidence-dependency invalidation ────────────────────────────────────────

export interface DependencyEdge {
  /** The derived object that depends on something. */
  dependentKey: string;
  dependentKind: 'OPPORTUNITY' | 'ANSWER_UNIT';
  /** The fact/entity it depends on. */
  dependsOn: string;
}

/**
 * Which derived objects must be re-evaluated when a set of facts changes.
 * Without this, an answer unit keeps asserting a compatibility that was
 * withdrawn — the exact failure this layer exists to prevent.
 */
export function invalidationTargets(edges: DependencyEdge[], changedFacts: string[]): {
  opportunities: string[];
  answerUnits: string[];
} {
  const changed = new Set(changedFacts);
  const opportunities = new Set<string>();
  const answerUnits = new Set<string>();
  for (const e of edges) {
    if (!changed.has(e.dependsOn)) continue;
    if (e.dependentKind === 'ANSWER_UNIT') answerUnits.add(e.dependentKey);
    else opportunities.add(e.dependentKey);
  }
  return { opportunities: [...opportunities].sort(), answerUnits: [...answerUnits].sort() };
}
