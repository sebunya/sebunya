import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/**
 * A backslash class inside a JavaScript template literal must be doubled to reach SQL.
 *
 * `sql\`... regexp_replace(phone, '\D', '', 'g') ...\`` looks right, but the template's cooked string turns
 * `\D` into a plain `D`, so the regex strips the letter D instead of every non-digit. Two phone matches
 * shipped like that (Customer DNA admin search, Care Desk alert throttle, found 2026-10-13): numbers with
 * spaces or dashes silently never matched. In a .ts file the SQL must read '\\D' (or \\d, \\s, \\w).
 */
const SRC = [join(__dirname, '../../apps/api/src'), join(__dirname, '../../apps/web/src'), join(__dirname, '../../scripts')];
function files(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) { if (e !== 'node_modules' && e !== 'dist') files(f, acc); }
    else if (/\.(ts|astro)$/.test(e) && !e.endsWith('.d.ts')) acc.push(f);
  }
  return acc;
}

describe('SQL regexes inside template literals', () => {
  it('double every backslash class so it reaches PostgreSQL', () => {
    const bad: string[] = [];
    for (const f of SRC.flatMap((d) => files(d))) {
      const text = readFileSync(f, 'utf8');
      // A SQL string literal argument of regexp_replace / ~ containing a single-backslash class.
      // regexp_replace(x, '<regex>', ...) and the regex operators x ~ '<regex>', x !~ '<regex>', x ~* '<regex>'.
      for (const m of text.matchAll(/(?:regexp_replace\([^`']*?|!?~\*?\s*)'((?:[^'\\]|\\.)*)'/g)) {
        if (/(^|[^\\])\\[dDsSwW+.()?*|[\]{}]/.test(m[1]!)) bad.push(`${f.replace(/^.*goldplus-commerce\//, '')}: '${m[1]}'`);
      }
    }
    expect(bad).toEqual([]);
  });
});
