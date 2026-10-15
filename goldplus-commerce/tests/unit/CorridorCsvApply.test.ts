import { describe, expect, it } from 'vitest';
import {
  ApplyCorridorCsvUseCase,
  CorridorChange,
  CorridorCsvRow,
  DryRunCorridorCsvUseCase,
  corridorChangesDigest,
} from '../../apps/api/src/application/use-cases/delivery/DeliveryCorridorCsvUseCase';

/**
 * 0189: the apply half of the corridor CSV round trip. The brief promised a
 * dry run "landing as one versioned change"; only the dry run existed, so a
 * re-band could not be done from the Control Centre at all.
 */
const stored = (): Map<string, CorridorCsvRow> =>
  new Map([
    ['kampala-ntinda', { areaSlug: 'kampala-ntinda', corridor: 'NTINDA', distanceBand: 'B2', accessMode: 'road', serviceable: true, fulfilmentMode: null }],
    ['kampala-kabalagala', { areaSlug: 'kampala-kabalagala', corridor: 'GGABA', distanceBand: 'B1', accessMode: 'road', serviceable: true, fulfilmentMode: null }],
  ]);

function harness() {
  const applied: CorridorChange[] = [];
  const audits: Array<Record<string, unknown>> = [];
  const repo = {
    currentCorridors: async () => stored(),
    applyChanges: async (changes: CorridorChange[]) => {
      applied.push(...changes);
      return changes.length;
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
    dry: new DryRunCorridorCsvUseCase(repo),
    apply: new ApplyCorridorCsvUseCase(repo, audit as never),
    applied,
    audits,
  };
}

const HEADER = 'area_slug,corridor,distance_band,access_mode';
const rebandNtinda = `${HEADER}\nkampala-ntinda,NTINDA,B3,road\nkampala-kabalagala,GGABA,B1,road`;
const unchanged = `${HEADER}\nkampala-ntinda,NTINDA,B2,road\nkampala-kabalagala,GGABA,B1,road`;
const broken = `${HEADER}\nkampala-ntinda,NTINDA,B9,road`;

describe('the dry run carries a confirmation digest', () => {
  it('is the digest of exactly the changes, and empty when nothing would change or a row fails', async () => {
    const h = harness();
    const run = await h.dry.execute(rebandNtinda);
    expect(run.changes).toEqual([{ areaSlug: 'kampala-ntinda', field: 'distance_band', from: 'B2', to: 'B3' }]);
    expect(run.confirmation).toBe(corridorChangesDigest(run.changes));
    expect(run.confirmation).toMatch(/^[0-9a-f]{64}$/);
    expect((await h.dry.execute(unchanged)).confirmation).toBe('');
    expect((await h.dry.execute(broken)).confirmation).toBe('');
  });
  it('does not depend on row order', () => {
    const a: CorridorChange[] = [
      { areaSlug: 'x', field: 'distance_band', from: 'B1', to: 'B2' },
      { areaSlug: 'y', field: 'corridor', from: 'A', to: 'B' },
    ];
    expect(corridorChangesDigest(a)).toBe(corridorChangesDigest([...a].reverse()));
    expect(corridorChangesDigest([])).toBe('');
  });
});

describe('apply', () => {
  it('refuses a digest that is not the dry run of this file, and writes nothing', async () => {
    const h = harness();
    const r = await h.apply.execute({ csv: rebandNtinda, confirmation: 'deadbeef', actorId: 'u1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('CONFIRMATION_MISMATCH');
    expect(h.applied).toEqual([]);
    expect(h.audits).toEqual([]);
  });
  it('refuses a file with any failing row, whole', async () => {
    const h = harness();
    const run = await h.dry.execute(broken);
    const r = await h.apply.execute({ csv: broken, confirmation: run.confirmation, actorId: 'u1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('FAILURES');
    expect(h.applied).toEqual([]);
  });
  it('refuses a file that changes nothing', async () => {
    const h = harness();
    const r = await h.apply.execute({ csv: unchanged, confirmation: '', actorId: 'u1' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('NOTHING_TO_APPLY');
  });
  it('applies exactly the changes the dry run showed, and audits them in one row', async () => {
    const h = harness();
    const run = await h.dry.execute(rebandNtinda);
    const r = await h.apply.execute({ csv: rebandNtinda, confirmation: run.confirmation, actorId: 'u1' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.applied).toBe(1);
      expect(r.areas).toBe(1);
      expect(r.batchId).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(h.applied).toEqual(run.changes);
    expect(h.audits).toHaveLength(1);
    const audit = h.audits[0] as { action?: string; newState?: { changes?: unknown; confirmation?: string } };
    expect(audit.action).toBe('DELIVERY_CORRIDORS_APPLIED');
    expect(audit.newState?.confirmation).toBe(run.confirmation);
    expect(audit.newState?.changes).toEqual(run.changes);
  });
});
