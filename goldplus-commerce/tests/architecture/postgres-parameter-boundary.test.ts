import { expect, test, describe } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * A whole-codebase guard against one specific, repeatedly-shipped defect.
 *
 * drizzle expands a raw JS ARRAY into comma-separated parameters, so
 *
 *     sql`set c = ${['a','b']}::jsonb`   ->   set c = ($1, $2)::jsonb
 *
 * casts a RECORD literal and fails at runtime with "cannot cast type record to
 * jsonb" (or "... to text[]"). An OBJECT binds as a single parameter and works,
 * which is precisely why this kept slipping through: the two forms are
 * indistinguishable to the typechecker and to code review, and only one fails.
 *
 * It reached production three times, and a fourth latent instance
 * (appliedRuleIds, a string[]) was found by this tranche's audit. So the rule
 * is now enforced structurally rather than by remembering it:
 *
 *     never interpolate a value directly before a cast — use PgParams.
 */

function readAllTsFiles(dir: string, fileList: string[] = []): string[] {
  if (!fs.existsSync(dir)) return fileList;
  for (const file of fs.readdirSync(dir)) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) readAllTsFiles(filePath, fileList);
    else if (filePath.endsWith('.ts')) fileList.push(filePath);
  }
  return fileList;
}

const API_SRC = path.join(__dirname, '../../apps/api/src');
const PG_PARAMS = path.join(API_SRC, 'infrastructure/db/PgParams.ts');

/**
 * `${...}::jsonb|json|text[]|uuid[]|numeric[]|int[]`
 *
 * NO trailing \b. Every array cast ends in `]`, and a word boundary cannot be
 * asserted between `]` and the `)` or `,` that follows it, so the anchored
 * version matched `::jsonb` and NEVER a single array cast — exactly the case
 * this rule was written for. Found 2026-08-29 when `any(${ids}::uuid[])` sailed
 * through it. The alternation is already specific enough to need no anchor.
 */
const RAW_CAST = /\$\{([^{}]*?)\}::(jsonb|json|text\[\]|uuid\[\]|numeric\[\]|int\[\])(?![a-zA-Z])/g;

/**
 * Forms that cannot produce a record literal:
 *  - JSON.stringify(...)      — a string, one parameter
 *  - client.json(...)         — postgres.js wraps it as one parameter
 *  - a PgParams helper        — the sanctioned boundary
 */
const SAFE_INNER = /JSON\.stringify\(|client\.json\(|\bpg(Jsonb|Json|TextArray|UuidArray|NumberArray|InTextList)\(/;

describe('PostgreSQL typed-parameter boundary', () => {
  const files = readAllTsFiles(API_SRC).filter((f) => f !== PG_PARAMS && !f.endsWith('.d.ts'));

  test('no value is interpolated directly before a Postgres cast', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      content.split('\n').forEach((line, i) => {
        if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return;
        for (const m of line.matchAll(RAW_CAST)) {
          if (SAFE_INNER.test(m[1])) continue;
          offenders.push(`${path.relative(API_SRC, file)}:${i + 1}  ${line.trim().slice(0, 100)}`);
        }
      });
    }

    expect(
      offenders,
      `Interpolating a value directly before a cast breaks whenever that value is (or becomes) ` +
      `an array: drizzle emits ($1, $2)::type, which PostgreSQL rejects as a record cast. ` +
      `Route these through apps/api/src/infrastructure/db/PgParams.ts:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  test('the boundary module itself is present and exports the sanctioned helpers', () => {
    // If someone deletes PgParams, the test above would silently pass by
    // finding no call sites to complain about.
    expect(fs.existsSync(PG_PARAMS)).toBe(true);
    const src = fs.readFileSync(PG_PARAMS, 'utf-8');
    for (const helper of ['pgTextArray', 'pgUuidArray', 'pgNumberArray', 'pgJsonb', 'pgJson', 'pgInTextList']) {
      expect(src).toMatch(new RegExp(`export function ${helper}\\b`));
    }
  });
});
