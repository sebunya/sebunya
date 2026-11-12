import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { DrizzleCorridorCsvRepository } from '../../apps/api/src/infrastructure/db/repositories/DrizzleCorridorCsvRepository';
import { CorridorChangedError } from '../../apps/api/src/application/use-cases/delivery/DeliveryCorridorCsvUseCase';

/**
 * The corridor table's side of the CSV round trip (moved out of the Registry,
 * 2026-11). Checked on the SQL actually sent, rendered by the Postgres dialect:
 * the apply is one transaction behind the corridor write lock, every field is a
 * compare-and-set on its `from`, and a row that moved aborts the whole batch.
 */

const { execute, txExecute, transaction } = vi.hoisted(() => {
  const txExecute = vi.fn(async (_query: unknown): Promise<unknown> => ({ count: 1 }));
  return {
    execute: vi.fn(async (_query: unknown): Promise<unknown> => []),
    txExecute,
    transaction: vi.fn(async (fn: (tx: { execute: typeof txExecute }) => Promise<unknown>) => fn({ execute: txExecute })),
  };
});
vi.mock('../../apps/api/src/infrastructure/db/client', () => ({
  db: { execute: (q: unknown) => execute(q), transaction: (fn: never) => transaction(fn) },
}));

const dialect = new PgDialect();
const render = (q: unknown) => {
  const query = dialect.sqlToQuery(q as SQL);
  return { text: query.sql.replace(/\s+/g, ' ').trim(), params: query.params };
};
const txQueries = () => txExecute.mock.calls.map((c) => render(c[0]));

const findByEntity = vi.fn(async (_entity: string, _id: string): Promise<Array<Record<string, unknown>>> => []);
const repo = new DrizzleCorridorCsvRepository({ findByEntity } as never);

const LOCK = { text: "select pg_advisory_xact_lock(hashtext('delivery_corridor_apply'))", params: [] };
const set = (column: string) =>
  `update delivery_corridor set ${column} = $1, data_version = data_version + 1, updated_at = now() where area_slug = $2 and ${column} = $3`;

beforeEach(() => {
  execute.mockReset().mockResolvedValue([]);
  txExecute.mockReset().mockResolvedValue({ count: 1 });
  transaction.mockClear();
  findByEntity.mockReset().mockResolvedValue([]);
});

describe('applyChanges', () => {
  it('takes the corridor write lock, then one compare-and-set per field, all in one transaction', async () => {
    await expect(
      repo.applyChanges([
        { areaSlug: 'kampala-ntinda', field: 'corridor', from: 'NTINDA', to: 'KIRA' },
        { areaSlug: 'kampala-ntinda', field: 'distance_band', from: 'B2', to: 'B3' },
        { areaSlug: 'kampala-kabalagala', field: 'access_mode', from: 'road', to: 'boda_only' },
      ]),
    ).resolves.toBe(2); // distinct areas, not changes
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
    expect(txQueries()).toEqual([
      LOCK,
      { text: set('corridor'), params: ['KIRA', 'kampala-ntinda', 'NTINDA'] },
      { text: set('distance_band'), params: ['B3', 'kampala-ntinda', 'B2'] },
      { text: set('access_mode'), params: ['boda_only', 'kampala-kabalagala', 'road'] },
    ]);
  });

  it('binds serviceable as a boolean on both sides', async () => {
    await repo.applyChanges([{ areaSlug: 'wakiso-gayaza', field: 'serviceable', from: 'true', to: 'false' }]);
    expect(txQueries()[1]).toEqual({ text: set('serviceable'), params: [false, 'wakiso-gayaza', true] });
  });

  it('reads "(derived)" as no fulfilment mode, and matches it null-safely', async () => {
    await repo.applyChanges([
      { areaSlug: 'mukono-seeta', field: 'fulfilment_mode', from: '(derived)', to: 'BUS' },
      { areaSlug: 'jinja-town', field: 'fulfilment_mode', from: 'BUS', to: '(derived)' },
    ]);
    const text =
      'update delivery_corridor set fulfilment_mode = $1, data_version = data_version + 1, updated_at = now() where area_slug = $2 and fulfilment_mode is not distinct from $3';
    expect(txQueries().slice(1)).toEqual([
      { text, params: ['BUS', 'mukono-seeta', null] },
      { text, params: [null, 'jinja-town', 'BUS'] },
    ]);
  });

  it('aborts the batch at the first row that no longer carries its from value', async () => {
    txExecute
      .mockResolvedValueOnce([]) // the lock
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const run = repo.applyChanges([
      { areaSlug: 'kampala-ntinda', field: 'corridor', from: 'NTINDA', to: 'KIRA' },
      { areaSlug: 'kampala-kabalagala', field: 'corridor', from: 'GGABA', to: 'MUNYONYO' },
      { areaSlug: 'wakiso-gayaza', field: 'corridor', from: 'GAYAZA', to: 'KIRA' },
    ]);
    await expect(run).rejects.toBeInstanceOf(CorridorChangedError);
    await expect(run).rejects.toMatchObject({ areaSlug: 'kampala-kabalagala' });
    expect(txExecute).toHaveBeenCalledTimes(3); // the third change is never sent
  });

  it('treats a result without a count as a missed row, never as success', async () => {
    txExecute.mockResolvedValueOnce([]).mockResolvedValueOnce(undefined);
    await expect(repo.applyChanges([{ areaSlug: 'kampala-ntinda', field: 'corridor', from: 'NTINDA', to: 'KIRA' }])).rejects.toBeInstanceOf(CorridorChangedError);
  });

  it('refuses a field it does not know rather than skipping it', async () => {
    await expect(repo.applyChanges([{ areaSlug: 'kampala-ntinda', field: 'fee_ugx', from: '5000', to: '0' }])).rejects.toThrow(
      'corridor apply: unknown field fee_ugx',
    );
    expect(txQueries()).toEqual([LOCK]);
  });
});

describe('findBatch', () => {
  const changes = [{ areaSlug: 'kampala-ntinda', field: 'corridor', from: 'NTINDA', to: 'KIRA' }];

  it('reads the applied batch from the audit trail', async () => {
    findByEntity.mockResolvedValueOnce([
      { action: 'DELIVERY_CORRIDORS_REVERTED', newState: { changes: [] } },
      { action: 'DELIVERY_CORRIDORS_APPLIED', newState: { changes, reason: 'Kira road reopened' } },
    ]);
    await expect(repo.findBatch('batch-1')).resolves.toEqual({ changes, reason: 'Kira road reopened' });
    expect(findByEntity).toHaveBeenCalledWith('delivery_corridor_batch', 'batch-1');
  });

  it('answers a missing reason as null', async () => {
    findByEntity.mockResolvedValueOnce([{ action: 'DELIVERY_CORRIDORS_APPLIED', newState: { changes } }]);
    await expect(repo.findBatch('batch-1')).resolves.toEqual({ changes, reason: null });
  });

  it('is null when there is no applied batch or it carries no changes', async () => {
    await expect(repo.findBatch('batch-1')).resolves.toBeNull();
    findByEntity.mockResolvedValueOnce([{ action: 'DELIVERY_CORRIDORS_REVERTED', newState: { changes } }]);
    await expect(repo.findBatch('batch-1')).resolves.toBeNull();
    findByEntity.mockResolvedValueOnce([{ action: 'DELIVERY_CORRIDORS_APPLIED', newState: {} }]);
    await expect(repo.findBatch('batch-1')).resolves.toBeNull();
  });
});

describe('currentCorridors', () => {
  it('reads every corridor row, keyed by area', async () => {
    execute.mockResolvedValueOnce([
      { area_slug: 'kampala-ntinda', corridor: 'NTINDA', distance_band: 'B2', access_mode: 'road', serviceable: true, fulfilment_mode: null },
      { area_slug: 'jinja-town', corridor: 'JINJA', distance_band: 'B6', access_mode: 'road', serviceable: 0, fulfilment_mode: 'BUS' },
    ]);
    const rows = await repo.currentCorridors();
    expect(render(execute.mock.calls[0][0])).toEqual({
      text: 'select area_slug, corridor, distance_band, access_mode, serviceable, fulfilment_mode from delivery_corridor',
      params: [],
    });
    expect([...rows.keys()]).toEqual(['kampala-ntinda', 'jinja-town']);
    expect(rows.get('kampala-ntinda')).toEqual({
      areaSlug: 'kampala-ntinda', corridor: 'NTINDA', distanceBand: 'B2', accessMode: 'road', serviceable: true, fulfilmentMode: null,
    });
    expect(rows.get('jinja-town')).toEqual({
      areaSlug: 'jinja-town', corridor: 'JINJA', distanceBand: 'B6', accessMode: 'road', serviceable: false, fulfilmentMode: 'BUS',
    });
  });
});
