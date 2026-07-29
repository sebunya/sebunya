import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * `products_reserved_within_stock` was added NOT VALID so a pre-existing
 * violation could not block the deploy. That is a starting position, not a
 * resting one — while it stays unvalidated the invariant binds only new writes.
 *
 * The readiness gate must never close the gap by acting on customer orders.
 */
const script = readFileSync(
  join(__dirname, '../../scripts/db/inventory-constraint-readiness.sh'),
  'utf8',
);

describe('inventory constraint readiness gate', () => {
  it('never releases a reservation or raises stock to make validation pass', () => {
    // Both would destroy the evidence the constraint exists to surface, and
    // both are decisions about specific named customer orders.
    expect(script).not.toMatch(/update\s+products\s+set\s+stock_quantity/i);
    expect(script).not.toMatch(/update\s+products\s+set\s+reserved_quantity/i);
    expect(script).not.toMatch(/update\s+inventory_reservations\s+set/i);
    expect(script).not.toMatch(/delete\s+from\s+inventory_reservations/i);
  });

  it('reports affected products AND the customer orders behind them', () => {
    // A bare count is not something an operator can act on.
    expect(script).toContain('-- affected products --');
    expect(script).toContain('-- customer orders holding the unbacked reservations --');
    expect(script).toContain('order_number');
  });

  it('refuses to pass while unexplained violations remain', () => {
    expect(script).toContain('NOT_READY');
    expect(script).toMatch(/exit 3/);
  });

  it('requires recorded evidence for every waiver', () => {
    expect(script).toContain('WAIVER_WITHOUT_EVIDENCE');
    expect(script).toContain('WAIVER_MALFORMED');
  });

  it('does not treat a waiver as making the data consistent', () => {
    // A waived row still violates, so VALIDATE genuinely cannot succeed. Saying
    // otherwise would be the script lying about the database.
    expect(script).toContain('A waiver defers the');
    expect(script).toContain('it does not make the data consistent');
  });

  it('verifies convalidated actually became true rather than assuming it', () => {
    expect(script).toContain('VALIDATION_DID_NOT_TAKE');
    expect(script).toContain('convalidated');
  });

  it('offers a report-only mode that cannot alter anything', () => {
    expect(script).toContain('--report-only');
    expect(script).toContain('REPORT_ONLY');
  });
});
