import { sql, type SQL } from 'drizzle-orm';

/**
 * Typed PostgreSQL parameter boundary.
 *
 * The same defect has now reached production three times in this codebase:
 *
 *   1. RecommendationMaterializer — a JS array bound into `::jsonb`, froze the
 *      recommendation cache for seven days.
 *   2. OrganicIntelligenceRunner — a JS array bound into `::text[]`, caught by
 *      the production-shaped proof.
 *   3. (and the near-miss in the Guardian's alert upsert, a different family
 *      but the same root cause: assuming the driver infers the intended type.)
 *
 * The mechanism is drizzle's `sql` template, not the driver, and it is worth
 * stating exactly because the wrong mental model is what let it recur:
 *
 *   sql`set c = ${['a','b']}::jsonb`  ->  set c = ($1, $2)::jsonb
 *   sql`set c = ${{ a: 1 }}::jsonb`   ->  set c = $1::jsonb
 *
 * Drizzle expands a raw JS ARRAY into comma-separated parameters, so the cast
 * lands on a RECORD literal `($1, $2)` — hence the runtime errors
 * "cannot cast type record to jsonb" and "cannot cast type record to text[]".
 * An OBJECT binds as a single parameter, which is why `${obj as never}::jsonb`
 * has always worked and misled everyone into thinking the array form was fine
 * too. Both forms typecheck identically; only the array form fails, and only
 * at runtime, against a real database.
 *
 * (Verified against PostgreSQL directly: `select ($1,$2)::jsonb` fails with
 * the production error, `select $1::text::jsonb` succeeds.)
 *
 * The rule: never write `${jsValue}::sometype`. Always go through here — these
 * helpers bind exactly one scalar parameter, which no cast can misinterpret.
 */

/**
 * A text[] literal. Empty arrays are handled explicitly, because
 * `'{}'::text[]` and a NULL array are different things and the difference
 * matters for `= ANY(...)`.
 */
export function pgTextArray(values: readonly unknown[]): SQL {
  const items = (values ?? []).map((v) => String(v ?? ''));
  if (items.length === 0) return sql`'{}'::text[]`;
  // Bound as JSON and expanded server-side: the one form that cannot be
  // mis-inferred, whatever the values contain.
  return sql`(select coalesce(array_agg(value), '{}')::text[] from jsonb_array_elements_text(${JSON.stringify(items)}::text::jsonb))`;
}

/** A uuid[] literal. Invalid uuids are rejected here rather than at the DB. */
export function pgUuidArray(values: readonly unknown[]): SQL {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const items = (values ?? []).map((v) => String(v ?? '')).filter((v) => UUID.test(v));
  if (items.length === 0) return sql`'{}'::uuid[]`;
  return sql`(select coalesce(array_agg(value::uuid), '{}')::uuid[] from jsonb_array_elements_text(${JSON.stringify(items)}::text::jsonb))`;
}

/** A numeric[] literal. Non-finite values are dropped, never coerced to 0. */
export function pgNumberArray(values: readonly unknown[]): SQL {
  const items = (values ?? []).map((v) => Number(v)).filter((n) => Number.isFinite(n));
  if (items.length === 0) return sql`'{}'::numeric[]`;
  return sql`(select coalesce(array_agg(value::numeric), '{}')::numeric[] from jsonb_array_elements_text(${JSON.stringify(items)}::text::jsonb))`;
}

/**
 * A jsonb value. Objects AND arrays both go through JSON.stringify then a
 * text cast — the object-only shortcut (`${obj}::jsonb`) is what broke the
 * recommendation cache when someone passed an array to it.
 */
export function pgJsonb(value: unknown): SQL {
  return sql`${JSON.stringify(value ?? null)}::text::jsonb`;
}

/** A json (not jsonb) value, for the rare column that needs key order kept. */
export function pgJson(value: unknown): SQL {
  return sql`${JSON.stringify(value ?? null)}::text::json`;
}

/**
 * Membership test. Use instead of `= ANY(${array}::text[])`, which is the
 * exact expression that failed in production.
 */
export function pgInTextList(column: SQL, values: readonly unknown[]): SQL {
  const items = (values ?? []).map((v) => String(v ?? ''));
  // An empty list must match nothing — `in ()` is a syntax error, and
  // omitting the predicate would silently match everything.
  if (items.length === 0) return sql`false`;
  return sql`${column} in (select jsonb_array_elements_text(${JSON.stringify(items)}::text::jsonb))`;
}
