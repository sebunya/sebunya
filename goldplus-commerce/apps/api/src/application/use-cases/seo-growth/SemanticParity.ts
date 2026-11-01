/**
 * Semantic parity between incremental and full-rebuild materialisation.
 *
 * This is the gate that makes narrowed incremental execution trustworthy. The
 * claim it tests is exact:
 *
 *     for the SAME source snapshot, evaluating only the affected entities must
 *     produce the SAME semantic truth as evaluating everything.
 *
 * If that does not hold, the planner is missing a dependency edge and the
 * portfolio will quietly go stale — the single worst outcome available to this
 * layer, because nothing looks broken.
 *
 * Two rules keep the gate honest:
 *
 *   Comparing runs that read different source states proves nothing. Such a
 *   comparison returns INCONCLUSIVE, never PASS and never FAIL. A parity test
 *   built on moving inputs is worse than no test, because it eventually gets
 *   muted for flapping.
 *
 *   A mismatch must be diagnosable. Whole-blob equality tells you something
 *   broke; per-entity fingerprints tell you which entity, in which domain, on
 *   which field.
 */

import { createHash } from 'node:crypto';

export const PARITY_DOMAINS = [
  'OPPORTUNITIES', 'SCORE_COMPONENTS', 'QUERY_CLUSTERS', 'QUERY_MEMBERSHIPS',
  'INTENTS', 'CURRENT_OWNERSHIP', 'PREFERRED_OWNERSHIP', 'CANNIBALISATION',
  'CONTENT_INTELLIGENCE', 'CONTENT_GAPS', 'ANSWER_UNITS', 'ROOT_CAUSES',
  'PORTFOLIO_PRIORITY', 'WORK_ITEMS', 'ACTION_REQUESTS',
] as const;
export type ParityDomain = (typeof PARITY_DOMAINS)[number];

/**
 * Fields that legitimately differ between two executions of the same logic and
 * carry no meaning. Everything NOT listed here is semantic and is compared —
 * the list is deliberately an allowlist of exclusions, so a new field is
 * compared by default rather than silently ignored.
 */
export const NON_SEMANTIC_FIELDS = new Set([
  'id', 'run_id', 'created_at', 'updated_at', 'last_seen_at', 'first_seen_at',
  'started_at', 'finished_at', 'occurred_at', 'source_observed_at',
  'last_material_change_at', 'snapshot_id',
]);

export interface ParityRecord {
  domain: ParityDomain;
  entityKey: string;
  fields: Record<string, unknown>;
}

export interface Fingerprint {
  domain: ParityDomain;
  entityKey: string;
  semanticHash: string;
  fields: Record<string, unknown>;
}

/**
 * Canonicalise a value so that only meaning affects the hash.
 *
 * UNKNOWN and zero must hash differently — the entire evidence model rests on
 * that distinction, and a fingerprint that folded null into 0 would let a
 * regression from "we don't know" to "we measured none" pass as parity.
 */
function canonical(value: unknown): unknown {
  if (value === null || value === undefined) return { __unknown: true };
  if (Array.isArray(value)) {
    // Collections compare as sets: two runs may legitimately emit the same
    // members in a different order.
    return value.map(canonical).map((v) => JSON.stringify(v)).sort();
  }
  if (typeof value === 'object') {
    const o = value as Record<string, unknown>;
    return Object.keys(o).sort().map((k) => [k, canonical(o[k])]);
  }
  // Numeric strings from the driver must compare equal to their numbers.
  if (typeof value === 'string' && value !== '' && !Number.isNaN(Number(value))) return Number(value);
  return value;
}

export function fingerprint(record: ParityRecord): Fingerprint {
  const semantic: Record<string, unknown> = {};
  for (const key of Object.keys(record.fields).sort()) {
    if (NON_SEMANTIC_FIELDS.has(key)) continue;
    semantic[key] = canonical(record.fields[key]);
  }
  const semanticHash = createHash('sha256')
    .update(JSON.stringify([record.domain, record.entityKey, semantic]))
    .digest('hex')
    .slice(0, 32);
  return { domain: record.domain, entityKey: record.entityKey, semanticHash, fields: semantic };
}

export interface ParityMismatch {
  domain: ParityDomain;
  entityKey: string;
  incrementalHash: string | null;
  fullHash: string | null;
  /** Field-level differences, so the missing dependency edge is findable. */
  fieldDifferences: Array<{ field: string; incremental: unknown; full: unknown }>;
  /** Which side is missing the record entirely, if either. */
  presence: 'BOTH' | 'INCREMENTAL_ONLY' | 'FULL_ONLY';
}

export type ParityVerdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

export interface ParityResult {
  verdict: ParityVerdict;
  reason: string;
  comparedDomains: ParityDomain[];
  recordsCompared: number;
  mismatches: ParityMismatch[];
}

/**
 * Compare two materialisation outcomes.
 *
 * `incrementalSnapshotId` and `fullSnapshotId` MUST match. If they do not, the
 * two runs read different source truth and any difference between them is
 * unattributable — that is INCONCLUSIVE, and calling it PASS would be the more
 * dangerous mistake of the two.
 */
export function compareParity(input: {
  incrementalSnapshotId: string | null;
  fullSnapshotId: string | null;
  incremental: ParityRecord[];
  full: ParityRecord[];
}): ParityResult {
  if (!input.incrementalSnapshotId || !input.fullSnapshotId) {
    return {
      verdict: 'INCONCLUSIVE',
      reason: 'One or both runs did not record a source snapshot, so there is no evidence they read the same source state.',
      comparedDomains: [], recordsCompared: 0, mismatches: [],
    };
  }
  if (input.incrementalSnapshotId !== input.fullSnapshotId) {
    return {
      verdict: 'INCONCLUSIVE',
      reason: `Source state moved between the runs (${input.incrementalSnapshotId} vs ${input.fullSnapshotId}). A difference here would say nothing about the algorithm.`,
      comparedDomains: [], recordsCompared: 0, mismatches: [],
    };
  }

  const key = (f: Fingerprint) => `${f.domain}::${f.entityKey}`;
  const inc = new Map(input.incremental.map(fingerprint).map((f) => [key(f), f]));
  const full = new Map(input.full.map(fingerprint).map((f) => [key(f), f]));
  const mismatches: ParityMismatch[] = [];
  const domains = new Set<ParityDomain>();

  for (const [k, f] of full) {
    domains.add(f.domain);
    const i = inc.get(k);
    if (!i) {
      mismatches.push({
        domain: f.domain, entityKey: f.entityKey, incrementalHash: null, fullHash: f.semanticHash,
        // The characteristic signature of a missing dependency edge: the full
        // rebuild found something the incremental run never looked at.
        fieldDifferences: [], presence: 'FULL_ONLY',
      });
      continue;
    }
    if (i.semanticHash === f.semanticHash) continue;

    const fields = new Set([...Object.keys(i.fields), ...Object.keys(f.fields)]);
    mismatches.push({
      domain: f.domain, entityKey: f.entityKey,
      incrementalHash: i.semanticHash, fullHash: f.semanticHash,
      fieldDifferences: [...fields]
        .filter((field) => JSON.stringify(i.fields[field]) !== JSON.stringify(f.fields[field]))
        .map((field) => ({ field, incremental: i.fields[field], full: f.fields[field] })),
      presence: 'BOTH',
    });
  }

  for (const [k, i] of inc) {
    domains.add(i.domain);
    if (full.has(k)) continue;
    mismatches.push({
      domain: i.domain, entityKey: i.entityKey, incrementalHash: i.semanticHash,
      fullHash: null, fieldDifferences: [], presence: 'INCREMENTAL_ONLY',
    });
  }

  return {
    verdict: mismatches.length === 0 ? 'PASS' : 'FAIL',
    reason: mismatches.length === 0
      ? `Both runs read source snapshot ${input.incrementalSnapshotId} and produced identical semantic state across ${domains.size} domain(s).`
      : `${mismatches.length} semantic mismatch(es) against the same source snapshot. Each one indicates a dependency the planner did not follow.`,
    comparedDomains: [...domains].sort(),
    recordsCompared: Math.max(inc.size, full.size),
    mismatches,
  };
}

/** Human-readable diagnostics for a failed gate. */
export function describeMismatches(mismatches: ParityMismatch[], limit = 20): string[] {
  return mismatches.slice(0, limit).map((m) => {
    const head = `${m.domain} ${m.entityKey} [${m.presence}]`;
    if (m.presence === 'FULL_ONLY') return `${head}: the full rebuild produced this and the incremental run did not — the planner never marked it affected.`;
    if (m.presence === 'INCREMENTAL_ONLY') return `${head}: the incremental run produced this and the full rebuild did not.`;
    const diffs = m.fieldDifferences
      .map((d) => `${d.field}: incremental=${JSON.stringify(d.incremental)} full=${JSON.stringify(d.full)}`)
      .join('; ');
    return `${head}: ${diffs}`;
  });
}
