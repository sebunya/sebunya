import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Drizzle applies a migration only when its journal "when" is GREATER than
 * the last applied migration's (drizzle-orm pg-core dialect: created_at <
 * folderMillis). Two entries sharing a "when", or one sorting below an
 * earlier one, means the later migration is silently never run on any
 * database that already holds the earlier one. Found 2026-10-06: 0173 shared
 * ...049 with the reverted 0172 still on the deploy branch, and 0174 briefly
 * shared ...050 with 0173.
 */
describe('migration journal', () => {
  const journal = JSON.parse(
    readFileSync(resolve(__dirname, '../../apps/api/src/infrastructure/db/migrations/meta/_journal.json'), 'utf8'),
  ) as { entries: Array<{ idx: number; when: number; tag: string }> };

  it('every "when" is strictly greater than the one before it', () => {
    const ties = journal.entries
      .slice(1)
      .map((e, i) => ({ prev: journal.entries[i], e }))
      .filter(({ prev, e }) => e.when <= prev.when)
      .map(({ prev, e }) => `${prev.tag} (${prev.when}) -> ${e.tag} (${e.when})`);
    expect(ties).toEqual([]);
  });

  it('0172_ad_usd_rate (reverted, never deployed) sorts below 0173, so deploying it first cannot hide 0173', () => {
    const t0173 = journal.entries.find((e) => e.tag === '0173_shop_building_zainab_aziza');
    expect(t0173?.when).toBeGreaterThan(1790140000049);
  });
});
