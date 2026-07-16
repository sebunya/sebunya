import { describe, it, expect } from 'vitest';
import { client } from '../../apps/api/src/infrastructure/db/client';

/**
 * Slice 10-E regression: the observability wrapper around client.unsafe must
 * preserve the postgres-js chainable Query API. The previous wrapper eagerly
 * .then()'d the query, replacing it with a plain Promise — drizzle's
 * `client.unsafe(...).values()` then crashed every db.select() with
 * "client.unsafe(...).values is not a function", the exact failure that
 * forced the 10-D production rollback. postgres-js queries are lazy, so
 * constructing one here performs no I/O.
 */
describe('Slice 10-E db client wrapper contract', () => {
  it('returns the chainable postgres-js Query, not a consumed Promise', () => {
    const q: any = client.unsafe('select 1');
    expect(typeof q.values, 'unsafe(...).values must remain callable (drizzle depends on it)').toBe('function');
    expect(typeof q.then).toBe('function');
    // .values() must return the same lazy query (chainable), still unexecuted.
    const chained = q.values();
    expect(typeof chained.then).toBe('function');
  });

});
