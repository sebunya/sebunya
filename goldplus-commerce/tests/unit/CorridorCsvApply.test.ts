import { describe, expect, it } from 'vitest';
import {
  ApplyCorridorCsvUseCase,
  CorridorChange,
  CorridorChangedError,
  CorridorCsvRow,
  DryRunCorridorCsvUseCase,
  RevertCorridorBatchUseCase,
  corridorChangesDigest,
} from '../../apps/api/src/application/use-cases/delivery/DeliveryCorridorCsvUseCase';
import { csvCell } from '../../apps/api/src/interfaces/http/csv';

/**
 * 0189: the apply half of the corridor CSV round trip (the brief promised a
 * dry run "landing as one versioned change"; only the dry run existed), with
 * the review board's additions: the shop's own quoted export must read back,
 * duplicate rows are refused, a reason is required, and a batch reverts in
 * one action.
 */
const stored = (): Map<string, CorridorCsvRow> =>
  new Map([
    ['kampala-ntinda', { areaSlug: 'kampala-ntinda', corridor: 'NTINDA', distanceBand: 'B2', accessMode: 'road', serviceable: true, fulfilmentMode: null }],
    ['kampala-kabalagala', { areaSlug: 'kampala-kabalagala', corridor: 'GGABA', distanceBand: 'B1', accessMode: 'road', serviceable: true, fulfilmentMode: null }],
  ]);

function harness(opts: { failOn?: string } = {}) {
  const rows = stored();
  const applied: CorridorChange[] = [];
  const audits: Array<Record<string, unknown>> = [];
  const repo = {
    currentCorridors: async () => new Map(rows),
    applyChanges: async (changes: CorridorChange[]) => {
      if (opts.failOn && changes.some((c) => c.areaSlug === opts.failOn)) throw new CorridorChangedError(opts.failOn);
      for (const c of changes) {
        const r = rows.get(c.areaSlug)!;
        if (c.field === 'distance_band') r.distanceBand = c.to;
        if (c.field === 'corridor') r.corridor = c.to;
      }
      applied.push(...changes);
      return new Set(changes.map((c) => c.areaSlug)).size;
    },
    findBatch: async (batchId: string) => {
      const a = audits.find((x) => x.entityId === batchId && x.action === 'DELIVERY_CORRIDORS_APPLIED') as { newState?: { changes: CorridorChange[]; reason: string } } | undefined;
      return a?.newState ? { changes: a.newState.changes, reason: a.newState.reason } : null;
    },
  };
  const audit = {
    save: async (log: unknown) => {
      audits.push(log as Record<string, unknown>);
    },
    findAll: async () => [],
    findByEntity: async () => [],
  };
  return {
    rows,
    dry: new DryRunCorridorCsvUseCase(repo),
    apply: new ApplyCorridorCsvUseCase(repo, audit as never),
    revert: new RevertCorridorBatchUseCase(repo, audit as never),
    applied,
    audits,
  };
}

const HEADER = 'area_slug,corridor,distance_band,access_mode';
const rebandNtinda = `${HEADER}\nkampala-ntinda,NTINDA,B3,road\nkampala-kabalagala,GGABA,B1,road`;
const unchanged = `${HEADER}\nkampala-ntinda,NTINDA,B2,road\nkampala-kabalagala,GGABA,B1,road`;
const broken = `${HEADER}\nkampala-ntinda,NTINDA,B9,road`;
const duplicated = `${HEADER}\nkampala-ntinda,NTINDA,B3,road\nkampala-kabalagala,GGABA,B1,road\nkampala-ntinda,NTINDA,B2,road`;
const REASON = 'parish points put Ntinda in B3';

describe('the dry run', () => {
  it('carries the digest of exactly the changes, and none when nothing would change or a row fails', async () => {
    const h = harness();
    const run = await h.dry.execute(rebandNtinda);
    expect(run.changes).toEqual([{ areaSlug: 'kampala-ntinda', field: 'distance_band', from: 'B2', to: 'B3' }]);
    expect(run.confirmation).toBe(corridorChangesDigest(run.changes));
    expect(run.confirmation).toMatch(/^[0-9a-f]{64}$/);
    expect((await h.dry.execute(unchanged)).confirmation).toBe('');
    expect((await h.dry.execute(broken)).confirmation).toBe('');
  });
  it("reads the Control Centre's own quoted export back (every cell quoted, formula guard on leading dashes)", async () => {
    const h = harness();
    const header = ['area_slug', 'corridor', 'distance_band', 'access_mode', 'serviceable', 'fulfilment_mode'];
    const exportCsv = [
      header.map(csvCell).join(','),
      ...[...stored().values()].map((r) => [r.areaSlug, r.corridor, r.distanceBand, r.accessMode, r.serviceable, r.fulfilmentMode].map(csvCell).join(',')),
    ].join('\n');
    const run = await h.dry.execute(exportCsv);
    expect(run.failures).toEqual([]);
    expect(run.changes).toEqual([]);
    expect(run.unchanged).toBe(2);
  });
  it('refuses a slug that appears twice instead of applying last-wins', async () => {
    const run = await harness().dry.execute(duplicated);
    expect(run.failures.map((f) => [f.line, f.areaSlug])).toEqual([[4, 'kampala-ntinda']]);
    expect(run.failures[0].problem).toMatch(/Duplicate area_slug \(first at line 2\)/);
    expect(run.confirmation).toBe('');
  });
  it('refuses a file far larger than the corridor table before reading it row by row', async () => {
    const huge = [HEADER, ...Array.from({ length: 5001 }, (_, i) => `slug-${i},C,B1,road`)].join('\n');
    const run = await harness().dry.execute(huge);
    expect(run.changes).toEqual([]);
    expect(run.failures).toHaveLength(1);
    expect(run.failures[0].problem).toMatch(/5001 rows/);
  });
  it('digest does not depend on row order', () => {
    const a: CorridorChange[] = [
      { areaSlug: 'x', field: 'distance_band', from: 'B1', to: 'B2' },
      { areaSlug: 'y', field: 'corridor', from: 'A', to: 'B' },
    ];
    expect(corridorChangesDigest(a)).toBe(corridorChangesDigest([...a].reverse()));
    expect(corridorChangesDigest([])).toBe('');
  });
});

describe('apply', () => {
  it('requires a reason (contract #9), and writes nothing without one', async () => {
    const h = harness();
    const run = await h.dry.execute(rebandNtinda);
    const r = await h.apply.execute({ csv: rebandNtinda, confirmation: run.confirmation, actorId: 'u1', reason: '' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('REASON_REQUIRED');
    expect(h.applied).toEqual([]);
  });
  it('refuses a digest that is not the dry run of this file', async () => {
    const h = harness();
    const r = await h.apply.execute({ csv: rebandNtinda, confirmation: 'deadbeef', actorId: 'u1', reason: REASON });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('CONFIRMATION_MISMATCH');
    expect(h.applied).toEqual([]);
    expect(h.audits).toEqual([]);
  });
  it('refuses a file with any failing row, whole', async () => {
    const h = harness();
    const run = await h.dry.execute(broken);
    const r = await h.apply.execute({ csv: broken, confirmation: run.confirmation, actorId: 'u1', reason: REASON });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('FAILURES');
  });
  it('refuses a file that changes nothing', async () => {
    const r = await harness().apply.execute({ csv: unchanged, confirmation: '', actorId: 'u1', reason: REASON });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOTHING_TO_APPLY');
  });
  it('refuses when a row moved between the dry run and the write (compare-and-set), and nothing lands', async () => {
    const h = harness({ failOn: 'kampala-ntinda' });
    const run = await h.dry.execute(rebandNtinda);
    const r = await h.apply.execute({ csv: rebandNtinda, confirmation: run.confirmation, actorId: 'u1', reason: REASON });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('CONFIRMATION_MISMATCH');
    expect(h.audits).toEqual([]);
  });
  it('applies exactly the changes the dry run showed, audits them with the reason, and a replay applies nothing', async () => {
    const h = harness();
    const run = await h.dry.execute(rebandNtinda);
    const r = await h.apply.execute({ csv: rebandNtinda, confirmation: run.confirmation, actorId: 'u1', reason: REASON });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.applied).toBe(1);
      expect(r.areas).toBe(1);
      expect(r.batchId).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(h.applied).toEqual(run.changes);
    const audit = h.audits[0] as { action?: string; newState?: { changes?: unknown; confirmation?: string; reason?: string } };
    expect(audit.action).toBe('DELIVERY_CORRIDORS_APPLIED');
    expect(audit.newState?.reason).toBe(REASON);
    expect(audit.newState?.changes).toEqual(run.changes);
    const again = await h.apply.execute({ csv: rebandNtinda, confirmation: run.confirmation, actorId: 'u1', reason: REASON });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.code).toBe('NOTHING_TO_APPLY');
  });
});

describe('revert', () => {
  it('inverts an applied batch in one action and audits it', async () => {
    const h = harness();
    const run = await h.dry.execute(rebandNtinda);
    const applied = await h.apply.execute({ csv: rebandNtinda, confirmation: run.confirmation, actorId: 'u1', reason: REASON });
    if (!applied.ok) throw new Error('apply failed');
    expect(h.rows.get('kampala-ntinda')?.distanceBand).toBe('B3');
    const r = await h.revert.execute({ batchId: applied.batchId, actorId: 'u2', reason: 'customers in Ntinda complained' });
    expect(r.ok).toBe(true);
    expect(h.rows.get('kampala-ntinda')?.distanceBand).toBe('B2');
    expect(h.applied.at(-1)).toEqual({ areaSlug: 'kampala-ntinda', field: 'distance_band', from: 'B3', to: 'B2' });
    expect(h.audits.at(-1)?.action).toBe('DELIVERY_CORRIDORS_REVERTED');
  });
  it('refuses an unknown batch and an empty reason', async () => {
    const h = harness();
    expect((await h.revert.execute({ batchId: 'nope', actorId: 'u', reason: 'because reasons' })).ok).toBe(false);
    expect((await h.revert.execute({ batchId: 'nope', actorId: 'u', reason: '' })).ok).toBe(false);
  });
});
