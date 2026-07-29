import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateStockAdjustment } from '../../apps/api/src/domain/inventory/Inventory';

/**
 * The invariant "reserved_quantity never exceeds stock_quantity" was documented
 * in the inventory domain but enforced nowhere: `products` carried no CHECK
 * constraint, and the admin product update wrote stock_quantity with no
 * knowledge of what was already reserved.
 *
 * The corruption was silent by construction — computeAvailable() clamps with
 * Math.max(0, …) and the dispatch deduction clamps with greatest(0, …), so a
 * stranded reservation read as an ordinary out-of-stock.
 */

describe('stock adjustment against existing reservations', () => {
  it('allows a stock level at or above what is reserved', () => {
    expect(validateStockAdjustment(5, 5).allowed).toBe(true);
    expect(validateStockAdjustment(5, 12).allowed).toBe(true);
    expect(validateStockAdjustment(0, 0).allowed).toBe(true);
  });

  it('refuses stock below what is already promised, and says by how much', () => {
    const decision = validateStockAdjustment(8, 3);
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.reason).toBe('RESERVED_EXCEEDS_STOCK');
    expect(decision.shortfall).toBe(5);
    expect(decision.message).toContain('8 unit(s) are already');
    expect(decision.message).toContain('5 unit(s) would be promised');
  });

  it('refuses zeroing stock while reservations are outstanding', () => {
    // The sharpest case: an update that omits the field entirely and defaults to 0.
    const decision = validateStockAdjustment(4, 0);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.shortfall).toBe(4);
  });

  it('refuses negative and fractional stock as a distinct reason', () => {
    for (const bad of [-1, 2.5, Number.NaN]) {
      const decision = validateStockAdjustment(0, bad);
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.reason).toBe('NEGATIVE_STOCK');
    }
  });

  it('does not tell the operator to force the number through', () => {
    const decision = validateStockAdjustment(8, 3);
    if (decision.allowed) throw new Error('expected refusal');
    // Releasing reservations is a decision about specific customer orders.
    expect(decision.message).toMatch(/Release or cancel/i);
  });
});

describe('migration 0052 enforcement strengths', () => {
  const sql = readFileSync(
    join(
      __dirname,
      '../../apps/api/src/infrastructure/db/migrations/0052_inventory_stock_invariants.sql',
    ),
    'utf8',
  );

  it('validates non-negativity immediately — it has no legitimate exception', () => {
    expect(sql).toContain('products_stock_non_negative');
    const clause = sql.slice(sql.indexOf('products_stock_non_negative'));
    const stanza = clause.slice(0, clause.indexOf('$$;'));
    expect(stanza).not.toContain('NOT VALID');
  });

  it('adds the reserved-within-stock constraint NOT VALID so a deploy is not blocked by legacy data', () => {
    expect(sql).toContain('products_reserved_within_stock');
    expect(sql).toMatch(/reserved_quantity" <= "stock_quantity"\)\s*NOT VALID/);
  });

  it('reports legacy violations rather than passing over them', () => {
    expect(sql).toContain('INVENTORY_STRANDED_RESERVATIONS');
    expect(sql).toContain('VALIDATE CONSTRAINT products_reserved_within_stock');
  });

  it('is idempotent — every constraint is guarded by an existence check', () => {
    const adds = sql.match(/ADD CONSTRAINT/g) ?? [];
    const guards = sql.match(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_constraint/g) ?? [];
    expect(adds.length).toBeGreaterThan(0);
    expect(guards.length).toBe(adds.length);
  });
});

describe('reservation lock ordering', () => {
  const repo = readFileSync(
    join(
      __dirname,
      '../../apps/api/src/infrastructure/db/repositories/DrizzleInventoryRepository.ts',
    ),
    'utf8',
  );

  it('orders the FOR UPDATE select so PostgreSQL takes locks in one global order', () => {
    // Sorting the id array in JavaScript does not control lock acquisition
    // order; without ORDER BY the LockRows node locks in scan order, which
    // varies with the plan, so concurrent multi-line orders can deadlock.
    const claim = repo.slice(repo.indexOf('const sortedIds'), repo.indexOf('const byId'));
    expect(claim).toContain('.orderBy(products.id)');
    expect(claim).toContain(".for('update')");
    expect(claim.indexOf('.orderBy(products.id)')).toBeLessThan(claim.indexOf(".for('update')"));
  });
});
