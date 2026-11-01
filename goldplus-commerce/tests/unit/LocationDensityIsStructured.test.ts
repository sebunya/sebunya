import { afterEach, describe, expect, it, vi } from 'vitest';

const execute = vi.fn();
vi.mock('../../apps/api/src/infrastructure/db/client', () => ({ db: { execute: (q: unknown) => execute(q) } }));

import { DENSITY_CACHE_MS, DrizzleLocationOrderDensityReader } from '../../apps/api/src/infrastructure/db/repositories/DrizzleLocationSearchRepository';

/**
 * Every location-search keystroke ran an orders x addresses LIKE join (34 s at
 * 20k x 3k) that counted one order once per matching saved address.
 */
function sqlText(q: unknown): string {
  const chunks = (q as { queryChunks?: unknown[] }).queryChunks ?? [];
  return chunks.map((c) => (typeof c === 'string' ? c : (c as { value?: string[] }).value?.join('') ?? '')).join('');
}

afterEach(() => execute.mockReset());

describe('order density comes from the structured per-order area link', () => {
  it('groups delivery_quote_capture by area_slug, with no text matching', async () => {
    execute.mockResolvedValue([{ area_slug: 'kira', n: 3 }]);
    const reader = new DrizzleLocationOrderDensityReader(() => 0);
    expect((await reader.densityByArea()).get('kira')).toBe(3);
    const text = sqlText(execute.mock.calls[0][0]);
    expect(text).toContain('from delivery_quote_capture q');
    expect(text).toContain('group by q.area_slug');
    expect(text).not.toMatch(/like/i);
    expect(text).not.toContain('addresses');
  });

  it('is cached per replica, so a keystroke does not re-aggregate', async () => {
    execute.mockResolvedValue([]);
    let now = 0;
    const reader = new DrizzleLocationOrderDensityReader(() => now);
    await Promise.all([reader.densityByArea(), reader.densityByArea()]);
    await reader.densityByArea();
    expect(execute).toHaveBeenCalledTimes(1);
    now = DENSITY_CACHE_MS + 1;
    await reader.densityByArea();
    expect(execute).toHaveBeenCalledTimes(2);
  });
});
