import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import {
  pgTextArray, pgUuidArray, pgNumberArray, pgJsonb, pgJson, pgInTextList,
} from '../../apps/api/src/infrastructure/db/PgParams';

/**
 * These tests exist because the same defect reached production three times: a
 * JavaScript array bound directly into `::jsonb` or `::text[]`, which
 * typechecks perfectly and fails only at runtime with
 * "cannot cast type record to ...".
 *
 * The rule they enforce is structural: a raw JS array or object must NEVER be
 * the value immediately preceding a cast. Everything goes through JSON text.
 * The generated SQL is separately executed against real PostgreSQL during the
 * migration rehearsal — unit tests alone cannot catch this class of defect.
 */

/**
 * The values drizzle will actually bind, in order, flattened across nested
 * fragments. Literal SQL text (StringChunk) is not a bound value; everything
 * else in the chunk list is.
 */
function params(q: ReturnType<typeof sql>): unknown[] {
  const out: unknown[] = [];
  const walk = (node: any) => {
    for (const c of node.queryChunks ?? []) {
      const kind = c?.constructor?.name;
      if (kind === 'StringChunk') continue;              // literal SQL text
      if (kind === 'SQL') { walk(c); continue; }         // nested fragment
      if (kind === 'Param') { out.push(c.value); continue; }
      out.push(c);
    }
  };
  walk(q as any);
  return out;
}

/**
 * True if any bound value is a raw array or plain object — the exact shape
 * postgres.js infers as a RECORD, which is what broke production three times.
 */
const bindsRawStructure = (q: ReturnType<typeof sql>) =>
  params(q).some((v: unknown) => Array.isArray(v) || (v !== null && typeof v === 'object'));

describe('no raw JavaScript structure is ever handed to a Postgres cast', () => {
  const cases: Array<[string, ReturnType<typeof sql>]> = [
    ['pgTextArray', pgTextArray(['a', 'b'])],
    ['pgUuidArray', pgUuidArray(['11111111-1111-1111-1111-111111111111'])],
    ['pgNumberArray', pgNumberArray([1, 2])],
    ['pgJsonb(array)', pgJsonb(['a', 'b'])],
    ['pgJsonb(object)', pgJsonb({ k: 'v' })],
    ['pgJson(object)', pgJson({ k: 'v' })],
    ['pgInTextList', pgInTextList(sql`col`, ['a', 'b'])],
  ];

  for (const [name, query] of cases) {
    it(`${name} binds only scalars`, () => {
      expect(bindsRawStructure(query)).toBe(false);
    });
  }

  it('binds arrays as JSON text, which is what makes the cast legal', () => {
    expect(params(pgJsonb(['a', 'b']))).toEqual(['["a","b"]']);
  });
});

describe('empty is handled explicitly, because empty and NULL are different', () => {
  it('produces an empty array literal rather than an empty parameter', () => {
    expect(params(pgTextArray([]))).toEqual([]);
    expect(params(pgUuidArray([]))).toEqual([]);
    expect(params(pgNumberArray([]))).toEqual([]);
  });

  it('makes an empty membership test match nothing rather than everything', () => {
    // Omitting the predicate would silently match every row — the most
    // dangerous possible failure for a delete or an update.
    const q = pgInTextList(sql`col`, []);
    expect(params(q)).toEqual([]);
    expect(JSON.stringify((q as any).queryChunks)).toContain('false');
  });
});

describe('values are preserved, not quietly coerced', () => {
  it('keeps quotes, unicode and whitespace intact', () => {
    const tricky = ["b'c", 'üñî', 'tab\there', '{brace}', 'comma,value', '"quoted"'];
    expect(params(pgTextArray(tricky))).toEqual([JSON.stringify(tricky)]);
  });

  it('drops non-finite numbers instead of turning them into 0', () => {
    // A 0 that was really NaN is a fabricated measurement.
    // Numbers stay JSON numbers; jsonb_array_elements_text renders them as
    // text server-side, which is verified against real PostgreSQL.
    expect(params(pgNumberArray([1, NaN, Infinity, 2]))).toEqual(['[1,2]']);
  });

  it('rejects malformed uuids before they reach the database', () => {
    expect(params(pgUuidArray(['not-a-uuid', '11111111-1111-1111-1111-111111111111'])))
      .toEqual(['["11111111-1111-1111-1111-111111111111"]']);
  });

  it('represents an absent value as JSON null, not as the string "undefined"', () => {
    expect(params(pgJsonb(undefined))).toEqual(['null']);
    expect(params(pgJsonb(null))).toEqual(['null']);
  });
});
