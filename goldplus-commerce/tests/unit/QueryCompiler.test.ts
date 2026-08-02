import { describe, it, expect } from 'vitest';
import { compileExplorerQuery } from '../../apps/api/src/domain/analytics/QueryCompiler';

describe('compileExplorerQuery — catalogue-approved, injection-proof', () => {
  it('compiles a valid metric-by-dimension query with a parameterized filter', () => {
    const r = compileExplorerQuery({
      metrics: ['paid_gmv_ugx', 'order_count'],
      dimensions: ['status'],
      filters: [{ column: 'payment_status', op: 'eq', value: 'paid' }],
      limit: 50,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sql).toContain('from orders');
    expect(r.sql).toContain('group by 1');
    expect(r.sql).toContain('payment_status = $1');
    expect(r.sql).toContain('limit 50');
    expect(r.params).toEqual(['paid']);
  });

  it('rejects an unknown metric, dimension, or filter column', () => {
    expect(compileExplorerQuery({ metrics: ['secret_costs'] })).toMatchObject({ ok: false });
    expect(compileExplorerQuery({ metrics: ['order_count'], dimensions: ['ssn'] })).toMatchObject({ ok: false });
    expect(
      compileExplorerQuery({ metrics: ['order_count'], filters: [{ column: 'dealer_price', op: 'eq', value: 'x' }] }),
    ).toMatchObject({ ok: false });
  });

  it('never lets a SQL-injection filter value reach the SQL string — it is a bound param', () => {
    const evil = "paid'; drop table orders; --";
    const r = compileExplorerQuery({
      metrics: ['order_count'],
      // created_at is a timestamp column; the injection is an invalid timestamp, rejected outright...
      filters: [{ column: 'created_at', op: 'gte', value: evil }],
    });
    expect(r.ok).toBe(false);

    // ...and even a valid text filter keeps the value OUT of the SQL string.
    const r2 = compileExplorerQuery({
      metrics: ['order_count'],
      filters: [{ column: 'status', op: 'eq', value: 'processing' }],
    });
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.sql).not.toContain('processing'); // the value is a param, not inlined
      expect(r2.sql).toContain('status = $1');
      expect(r2.params).toEqual(['processing']);
    }
  });

  it('rejects a text filter value outside the catalogue allowlist', () => {
    const r = compileExplorerQuery({
      metrics: ['order_count'],
      filters: [{ column: 'payment_status', op: 'eq', value: 'refunded' }],
    });
    expect(r.ok).toBe(false);
  });

  it('requires at least one metric and caps the row limit', () => {
    expect(compileExplorerQuery({ metrics: [] })).toMatchObject({ ok: false });
    const capped = compileExplorerQuery({ metrics: ['order_count'], limit: 999999 });
    expect(capped.ok).toBe(true);
    if (capped.ok) expect(capped.sql).toContain('limit 1000');
  });
});
