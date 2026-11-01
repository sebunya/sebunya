import { describe, expect, it } from 'vitest';

import {
  compareParity, fingerprint, describeMismatches, NON_SEMANTIC_FIELDS,
  type ParityRecord,
} from '../../apps/api/src/application/use-cases/seo-growth/SemanticParity';
import {
  Stage, summarise, renderReport,
} from '../../apps/api/src/application/use-cases/seo-growth/ProofHarness';

const rec = (entityKey: string, fields: Record<string, unknown>): ParityRecord =>
  ({ domain: 'OPPORTUNITIES', entityKey, fields });

const SNAP = 'snapshot-abc';

// ── Fingerprints (§15) ──────────────────────────────────────────────────────

describe('semantic fingerprints ignore noise and nothing else', () => {
  it('ignores run ids and timestamps', () => {
    const a = fingerprint(rec('o1', { score: 5, run_id: 'r1', created_at: 'T1' }));
    const b = fingerprint(rec('o1', { score: 5, run_id: 'r2', created_at: 'T2' }));
    expect(b.semanticHash).toBe(a.semanticHash);
  });

  it('does not ignore a field merely because it is new', () => {
    // Exclusions are an explicit allowlist, so an unlisted field is compared.
    const a = fingerprint(rec('o1', { score: 5 }));
    const b = fingerprint(rec('o1', { score: 5, newly_added_field: 'x' }));
    expect(b.semanticHash).not.toBe(a.semanticHash);
  });

  it('treats collections as sets rather than ordered lists', () => {
    const a = fingerprint(rec('o1', { blockers: ['A', 'B'] }));
    const b = fingerprint(rec('o1', { blockers: ['B', 'A'] }));
    expect(b.semanticHash).toBe(a.semanticHash);
  });

  it('distinguishes UNKNOWN from zero', () => {
    // The invariant the whole evidence model rests on.
    const unknown = fingerprint(rec('o1', { impressions: null }));
    const zero = fingerprint(rec('o1', { impressions: 0 }));
    expect(zero.semanticHash).not.toBe(unknown.semanticHash);
  });

  it('compares a numeric string equal to its number', () => {
    // The driver returns numerics as strings; that is not a semantic change.
    const a = fingerprint(rec('o1', { score: '5.0' }));
    const b = fingerprint(rec('o1', { score: 5 }));
    expect(b.semanticHash).toBe(a.semanticHash);
  });

  it('keeps the standard non-semantic exclusions', () => {
    for (const f of ['run_id', 'created_at', 'last_seen_at']) {
      expect(NON_SEMANTIC_FIELDS.has(f)).toBe(true);
    }
  });
});

// ── The gate itself (§13, §17) ──────────────────────────────────────────────

describe('parity is only meaningful against the same source snapshot', () => {
  it('passes when both runs agree on the same snapshot', () => {
    const records = [rec('o1', { score: 5 }), rec('o2', { score: 7 })];
    const r = compareParity({
      incrementalSnapshotId: SNAP, fullSnapshotId: SNAP,
      incremental: records, full: records,
    });
    expect(r.verdict).toBe('PASS');
  });

  it('is INCONCLUSIVE, not PASS, when the source state moved between runs', () => {
    const r = compareParity({
      incrementalSnapshotId: 'snap-1', fullSnapshotId: 'snap-2',
      incremental: [rec('o1', { score: 5 })], full: [rec('o1', { score: 5 })],
    });
    // Identical output from different inputs proves nothing either way.
    expect(r.verdict).toBe('INCONCLUSIVE');
    expect(r.verdict).not.toBe('PASS');
    expect(r.reason).toMatch(/moved between the runs/i);
  });

  it('is INCONCLUSIVE when a run recorded no snapshot at all', () => {
    const r = compareParity({
      incrementalSnapshotId: null, fullSnapshotId: SNAP,
      incremental: [], full: [],
    });
    expect(r.verdict).toBe('INCONCLUSIVE');
  });

  it('FAILS when the incremental run missed a record the rebuild produced', () => {
    const r = compareParity({
      incrementalSnapshotId: SNAP, fullSnapshotId: SNAP,
      incremental: [rec('o1', { score: 5 })],
      full: [rec('o1', { score: 5 }), rec('o2', { score: 7 })],
    });
    expect(r.verdict).toBe('FAIL');
    expect(r.mismatches[0].presence).toBe('FULL_ONLY');
    expect(r.mismatches[0].entityKey).toBe('o2');
  });

  it('FAILS when the same entity carries different meaning', () => {
    const r = compareParity({
      incrementalSnapshotId: SNAP, fullSnapshotId: SNAP,
      incremental: [rec('o1', { score: 5, bucket: 'NEXT' })],
      full: [rec('o1', { score: 9, bucket: 'NOW' })],
    });
    expect(r.verdict).toBe('FAIL');
    expect(r.mismatches[0].fieldDifferences.map((d) => d.field).sort()).toEqual(['bucket', 'score']);
  });

  it('passes when only non-semantic metadata differs', () => {
    const r = compareParity({
      incrementalSnapshotId: SNAP, fullSnapshotId: SNAP,
      incremental: [rec('o1', { score: 5, run_id: 'a', last_seen_at: 'T1' })],
      full: [rec('o1', { score: 5, run_id: 'b', last_seen_at: 'T2' })],
    });
    expect(r.verdict).toBe('PASS');
  });
});

// ── Diagnostics (§16) ───────────────────────────────────────────────────────

describe('a failed gate says where to look, not just that it failed', () => {
  it('names the domain, entity and field for a value mismatch', () => {
    const r = compareParity({
      incrementalSnapshotId: SNAP, fullSnapshotId: SNAP,
      incremental: [rec('o1', { score: 5 })],
      full: [rec('o1', { score: 9 })],
    });
    const [line] = describeMismatches(r.mismatches);
    expect(line).toContain('OPPORTUNITIES');
    expect(line).toContain('o1');
    expect(line).toContain('score');
  });

  it('explains a missing record as an unfollowed dependency', () => {
    const r = compareParity({
      incrementalSnapshotId: SNAP, fullSnapshotId: SNAP,
      incremental: [], full: [rec('o2', { score: 7 })],
    });
    expect(describeMismatches(r.mismatches)[0]).toMatch(/never marked it affected/i);
  });
});

// ── Fail-closed harness (§45, §46) ──────────────────────────────────────────

describe('the proof harness cannot report green without executing', () => {
  it('reports NOT_EXECUTED when no assertion ran, however clean the counters look', () => {
    // The exact defect this guards: zeros everywhere reading as success.
    const stage = new Stage('duplicates', 3);
    const report = summarise([stage]);

    expect(report.stages[0].result).toBe('NOT_EXECUTED');
    expect(report.stages[0].assertionsFailed).toBe(0);
    expect(report.green).toBe(false);
    expect(report.exitCode).toBe(1);
  });

  it('is not green when only some planned assertions ran', () => {
    const stage = new Stage('partial', 3);
    stage.check('one', true);
    const report = summarise([stage]);
    expect(report.stages[0].result).toBe('INCONCLUSIVE');
    expect(report.green).toBe(false);
  });

  it('is green only when every planned assertion ran and passed', () => {
    const stage = new Stage('complete', 2);
    stage.check('a', true);
    stage.check('b', true);
    const report = summarise([stage]);
    expect(report.stages[0].result).toBe('PASS');
    expect(report.green).toBe(true);
    expect(report.exitCode).toBe(0);
  });

  it('fails, exits non-zero and names the failing stage', () => {
    const ok = new Stage('ok', 1);
    ok.check('fine', true);
    const bad = new Stage('broken', 1);
    bad.check('this must fail', false);

    const report = summarise([ok, bad]);
    expect(report.green).toBe(false);
    expect(report.exitCode).toBe(1);
    expect(report.summary).toContain('broken=FAIL');
    // The assertion text must be visible, not swallowed by a summary line.
    expect(report.stages[1].failures).toContain('this must fail');
  });

  it('never ends a failed run on a green line', () => {
    const bad = new Stage('broken', 1);
    bad.check('nope', false);
    const lines = renderReport(summarise([bad]));
    expect(lines).toContain('HARNESS_GREEN=false');
    expect(lines).toContain('EXIT_CODE=1');
    expect(lines[lines.length - 1]).toMatch(/NOT GREEN/);
  });

  it('reports an aborted stage as INCONCLUSIVE rather than passing it', () => {
    const stage = new Stage('needs-database', 2);
    stage.abort('PostgreSQL was unreachable');
    const report = summarise([stage]);
    expect(report.stages[0].result).toBe('INCONCLUSIVE');
    expect(report.green).toBe(false);
  });

  it('is not green when there are no stages at all', () => {
    // An empty suite has proven nothing.
    expect(summarise([]).green).toBe(false);
  });

  it('surfaces expected-vs-actual for an equality assertion', () => {
    const stage = new Stage('counts', 1);
    stage.equals('opportunity count', 2, 3);
    expect(stage.report().failures[0]).toContain('expected 3, got 2');
  });
});
