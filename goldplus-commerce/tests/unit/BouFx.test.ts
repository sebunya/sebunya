import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveUgxPerUsd } from '../../apps/api/src/domain/measurement/MeasurementConfig';
import { RecordBouFxReadingUseCase } from '../../apps/api/src/application/use-cases/measurement/RecordBouFxReadingUseCase';
import { parseUsdRow } from '../../scripts/bou-fx.mjs';

/**
 * The Bank of Uganda dollar rate (2026-10-24): read off bou.or.ug at 1 pm by scripts/bou-fx.mjs, posted to
 * /internal/fx/bou, kept as control usd_ugx_bou, and preferred over the open market feed while fresh.
 */
const executed: string[] = [];
let canned: Array<{ match: string; rows: any[] }> = [];
function sqlText(q: unknown): string {
  const chunks = (q as { queryChunks?: unknown[] })?.queryChunks ?? [];
  return chunks.map((c): string => {
    if (c === null || c === undefined) return 'null';
    if (typeof c !== 'object') return String(c);
    if (Array.isArray((c as { value?: unknown }).value)) return ((c as { value: string[] }).value).join('');
    if ((c as { queryChunks?: unknown[] }).queryChunks) return sqlText(c);
    return '';
  }).join('');
}
vi.mock('../../apps/api/src/infrastructure/db/client', () => ({ db: { execute: async (q: unknown) => { const t = sqlText(q); executed.push(t); return canned.find((c) => t.includes(c.match))?.rows ?? []; } } }));
vi.mock('../../apps/api/src/infrastructure/logging/logger', () => ({ logger: { warn: () => undefined, info: () => undefined, error: () => undefined } }));
const { ControlFeeds } = await import('../../apps/api/src/infrastructure/measurement/ControlFeeds');

const EXPORT = `.,Currency,Indicator,Rate\r\n.,Euro/U.S. Dollar,Cross Rates,1.1215\r\n.,Euro/U.S. Dollar,Buying Rates,4820.685534\r\n.,U.S. Dollar/Uganda Shillings (UGX),Cross Rates,4303.81\r\n.,U.S. Dollar/Uganda Shillings (UGX),Buying Rates,4298.81\r\n.,U.S. Dollar/Uganda Shillings (UGX),Selling Rates,4308.81\r\n`;

describe('Bank of Uganda dollar rate', () => {
  beforeEach(() => { executed.length = 0; canned = []; });

  it('reads mid, buying and selling off the Power BI export and ignores every other currency', () => {
    expect(parseUsdRow(EXPORT)).toEqual({ mid: 4303.81, buying: 4298.81, selling: 4308.81 });
    expect(parseUsdRow('.,Currency,Indicator,Rate\n.,Euro/U.S. Dollar,Cross Rates,1.12')).toEqual({ mid: null, buying: null, selling: null });
    expect(parseUsdRow('.,U.S. Dollar/Uganda Shillings (UGX),Buying Rates,4000\n.,U.S. Dollar/Uganda Shillings (UGX),Selling Rates,4010').mid).toBe(4005);
  });

  it('the use case keeps a plausible reading for a real recent day and refuses nonsense', async () => {
    const stored: unknown[] = [];
    const uc = new RecordBouFxReadingUseCase({ recordBou: async (r) => { stored.push(r); } });
    const today = new Date().toISOString().slice(0, 10);
    expect(await uc.execute({ day: today, mid: 4303.81, buying: 4298.81, selling: 4308.81 })).toEqual({ ok: true, day: today, mid: 4303.81 });
    expect(stored[0]).toMatchObject({ day: today, mid: 4303.81, buying: 4298.81, selling: 4308.81, note: expect.stringContaining('Bank of Uganda mid rate') });
    expect((await uc.execute({ day: today, mid: 43 })).ok).toBe(false);
    expect((await uc.execute({ day: '2020-01-01', mid: 4300 })).ok).toBe(false);
    expect((await uc.execute({ day: 'today', mid: 4300 })).ok).toBe(false);
    expect((await uc.execute({ day: today, mid: 4300, buying: 4400, selling: 4200 })).ok).toBe(false); // sides the wrong way round
    expect(stored).toHaveLength(1);
  });

  it('a fresh BoU reading wins over the market feed; without one the feed is used; the detail names the source', async () => {
    canned = [{ match: "control_key = 'usd_ugx_bou'", rows: [{ day: '2026-10-24', value: '4303.81' }] }, { match: "control_key = 'usd_ugx' and source = 'feed'", rows: [{ day: '2026-10-24', value: '4166.17' }] }];
    const feeds = new ControlFeeds();
    expect(await feeds.latestFx()).toEqual({ day: '2026-10-24', ugxPerUsd: 4303.81, source: 'bou' });
    expect(executed[0]).toContain('current_date - 5');
    const r = resolveUgxPerUsd({ usd_ugx_margin: '200' }, { day: '2026-10-24', ugxPerUsd: 4303.81, source: 'bou' }, '2026-10-24');
    expect(r).toEqual({ rate: 4504, basis: 'feed', detail: 'Bank of Uganda mid 4304 on 2026-10-24 + 200 margin' });
    canned = [{ match: "control_key = 'usd_ugx' and source = 'feed'", rows: [{ day: '2026-10-24', value: '4166.17' }] }];
    expect(await feeds.latestFx()).toEqual({ day: '2026-10-24', ugxPerUsd: 4166.17, source: 'feed' });
    expect(resolveUgxPerUsd({}, { day: '2026-10-24', ugxPerUsd: 4166.17, source: 'feed' }, '2026-10-24').detail).toBe('market 4166 on 2026-10-24 + 100 margin');
    expect(resolveUgxPerUsd({ ugx_per_usd: '4000' }, { day: '2026-10-24', ugxPerUsd: 4303.81, source: 'bou' }, '2026-10-24')).toMatchObject({ rate: 4000, basis: 'manual' }); // a hand-set rate still wins
  });

  it('recording writes the bou row and never overwrites a row of another source', async () => {
    await new ControlFeeds().recordBou({ day: '2026-10-24', mid: 4303.81, buying: 4298.81, selling: 4308.81, note: 'n' });
    const w = executed.find((q) => q.includes('insert into measurement.control_series'));
    expect(w).toContain("'usd_ugx_bou'");
    expect(w).toContain("'bou'");
    expect(w).toContain("where measurement.control_series.source = 'bou'");
  });
});
