import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `goldplus_locations_seed.sql` is retired (delivery brief PART 8, PART 9 #13).
 *
 * It builds a `ug_area` with a different shape from migration 0084's — area_name
 * versus parish_or_area_clean, district_2019 versus district_2019_source — and
 * every CREATE in it is `IF NOT EXISTS`, so against a live database it skips
 * silently and then fails, and against an empty one it produces a schema the
 * application cannot read.
 *
 * Deleting it would be weaker than this: the file was supplied as a data
 * artifact and may be re-supplied. So the rule enforced here is that no
 * executable copy may exist — any copy must abort before its first DDL — and
 * that nothing in the codebase invokes it.
 */

const root = resolve(__dirname, '../..');
const dataDir = resolve(root, 'data/locations/v1');

describe('the retired seed script', () => {
  it('has no live .sql copy that could be piped into psql', () => {
    if (!existsSync(dataDir)) return; // data files are gitignored; nothing to check
    const live = readdirSync(dataDir).filter(
      (f) => f === 'goldplus_locations_seed.sql',
    );
    expect(live, 'an executable copy of the retired seed exists').toEqual([]);
  });

  it('aborts before any DDL if a retired copy is executed anyway', () => {
    if (!existsSync(dataDir)) return;
    const retired = readdirSync(dataDir).filter((f) => f.startsWith('goldplus_locations_seed.sql'));
    for (const file of retired) {
      const sql = readFileSync(resolve(dataDir, file), 'utf8');
      const firstDdl = sql.search(/\bCREATE\s+TABLE\b/i);
      const abort = sql.search(/RAISE\s+EXCEPTION/i);
      expect(abort, `${file} carries no abort guard`).toBeGreaterThanOrEqual(0);
      expect(abort, `${file} would create tables before aborting`).toBeLessThan(firstDdl);
      expect(sql).toMatch(/RETIRED/);
    }
  });

  it('is referenced by no code path — the CSV importers are the only route', () => {
    // grep the tracked tree, not the working tree, so an untracked scratch file
    // cannot fail this and a committed reference cannot hide from it.
    const tracked = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' })
      .split('\n')
      .filter((f) => /\.(ts|tsx|js|mjs|cjs|json|sh|ya?ml)$/.test(f));
    // This file is the enforcement, so it necessarily names the thing it bans.
    // Excluding it is the difference between a guard and a paradox.
    const SELF = 'tests/unit/DeliverySeedRetirement.test.ts';
    const offenders: string[] = [];
    for (const file of tracked) {
      if (file === SELF) continue;
      const full = resolve(root, file);
      if (!existsSync(full)) continue;
      if (readFileSync(full, 'utf8').includes('goldplus_locations_seed')) offenders.push(file);
    }
    expect(offenders, `these reference the retired seed: ${offenders.join(', ')}`).toEqual([]);
  });
});
