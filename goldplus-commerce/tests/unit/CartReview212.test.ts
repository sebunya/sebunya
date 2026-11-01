import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const read = (p: string) => readFileSync(path.resolve(__dirname, '../..', p), 'utf8');
const cart = read('apps/web/src/pages/cart.astro');
const client = read('apps/web/src/lib/checkoutClient.ts');

describe('cart review fixes (212)', () => {
  it('a quantity above 99 is saved as 99, written to the device copy and redirected, with a notice after', () => {
    expect(cart).toMatch(/if \(qty > 99\) quantityCapped = true;/);
    expect(cart).not.toMatch(/if \(qty > 99\) cartNotice/);
    expect(cart).toMatch(/if \(quantityCapped\) return Astro\.redirect\(lineAnchor\(productId\)\.replace\('\/cart', '\/cart\?capped=1'\), 303\);/);
    expect(cart).toMatch(/searchParams\.get\('capped'\) === '1'/);
  });

  it('Undo never takes a line past 99', () => {
    expect(cart).toMatch(/const restoreQty = Math\.max\(0, Math\.min\(removed\.quantity, 99 - \(existing\?\.quantity \?\? 0\)\)\);/);
    expect(cart).toMatch(/\{ productId, quantity: restoreQty \}/);
    // The arithmetic the page applies.
    const restore = (existing: number, removed: number) => Math.max(0, Math.min(removed, 99 - existing));
    expect(restore(60, 60)).toBe(39);
    expect(restore(99, 5)).toBe(0);
    expect(restore(0, 7)).toBe(7);
  });

  it('cookie product ids are filtered and encoded before /finder/check', () => {
    expect(cart).toMatch(/productIds=\$\{cartProductIds\.filter\(\(id\) => isCartProductId\(id\)\)\.map\(encodeURIComponent\)\.join\(','\)\}/);
  });

  it('pay by reference has a timeout like the other payment calls', () => {
    const fn = client.slice(client.indexOf('export async function startPaymentByReference'), client.indexOf('export function paymentStartMessageFor'));
    expect(fn).toMatch(/signal: AbortSignal\.timeout\(CHECKOUT_TIMEOUT_MS\)/);
  });
});
