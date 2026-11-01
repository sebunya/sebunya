import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Columns written through drizzle's plain jsonb() with .values({ col: obj }) are stored as jsonb STRINGS (drizzle
 * 0.29 + postgres-js), so raw SQL `col->>'key'` reads NULL with no error: delivery reports, the Customer 360 brand
 * and Google campaign attribution all read blank that way until 2026-10-20 (tests/integration/JsonbStringReads).
 * Every raw read of these columns goes through pgJsonObject (PgParams), which accepts both shapes.
 */
const STRING_STORED = ['new_state', 'previous_state', 'specifications', 'click_ids'];
const ROOT = resolve(__dirname, '../../apps/api/src');
const SKIP = /infrastructure\/db\/(migrations|baselines)\//;

const files = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
  const p = join(dir, e);
  return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') ? [p] : [];
});

describe('raw SQL never reads a string-stored jsonb column directly', () => {
  it('uses pgJsonObject for ->>, ->, ? and #>> on audit states, product specifications and click ids', () => {
    // `?` only as the jsonb key operator (`col ? 'key'`, `col ?| array[...]`), not a TypeScript optional or ternary.
    const bad = new RegExp(String.raw`(?:\b[a-z]\.)?\b(${STRING_STORED.join('|')})\s*(->>?|#>>?|\?[|&]?\s*(?:'|array\b))`, 'g');
    const offenders: string[] = [];
    for (const f of files(ROOT)) {
      const rel = relative(ROOT, f).replace(/\\/g, '/');
      if (SKIP.test(rel)) continue;
      const src = readFileSync(f, 'utf8');
      for (const m of src.matchAll(bad)) {
        const line = src.slice(0, m.index).split('\n').length;
        offenders.push(`${rel}:${line} ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
