import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The synthetic monitor must never look like a customer (2026-11-03): production held 245 "carts with items"
 * and 198 "abandoned baskets" a week that were all its own five-minute runs. It names itself on every request
 * and deletes the cart each run creates, pass or fail.
 */
const src = readFileSync(resolve(__dirname, '../../apps/api/src/infrastructure/scheduler/SyntheticMonitor.ts'), 'utf8');
const declared = readFileSync(resolve(__dirname, '../../apps/api/src/application/use-cases/telemetry/DeclaredAutomation.ts'), 'utf8');

describe('synthetic monitor leaves no customer-looking trace', () => {
  it('sends a user agent the collector and relays recognise as declared automation', () => {
    expect(src).toContain("export const SYNTHETIC_MONITOR_USER_AGENT = 'GoldPlusSyntheticProbe/1.0 (synthetic monitor)';");
    expect(declared).toMatch(/GoldPlusSyntheticProbe/);
    const fetchHeaderBlocks = src.match(/headers: \{/g)?.length ?? 0;
    const withUa = src.match(/'user-agent': SYNTHETIC_MONITOR_USER_AGENT/g)?.length ?? 0;
    expect(withUa, 'every fetch the monitor makes carries the declared user agent').toBe(fetchHeaderBlocks);
  });
  it('records the cart id it created and discards it in a finally, so a failed run cannot leave a basket behind', () => {
    expect(src).toContain("syntheticCartId = typeof cartBody?.data?.id === 'string' ? cartBody.data.id : null;");
    expect(src).toMatch(/\} finally \{\s*await this\.discardSyntheticCart\(syntheticCartId\);\s*\}/);
    expect(src).toContain('await db.delete(cartAbandonments).where(eq(cartAbandonments.cartId, cartId));');
    expect(src).toContain('await db.delete(cartItems).where(eq(cartItems.cartId, cartId));');
    expect(src).toContain('await db.delete(carts).where(eq(carts.id, cartId));');
    // abandonment record first, then lines, then the cart: the foreign keys allow no other order
    expect(src.indexOf('db.delete(cartAbandonments)')).toBeLessThan(src.indexOf('db.delete(cartItems)'));
    expect(src.indexOf('db.delete(cartItems)')).toBeLessThan(src.indexOf('db.delete(carts)'));
  });
});
