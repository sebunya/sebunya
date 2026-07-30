import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { scopeClientOrderKey } from '../../apps/api/src/domain/commerce/Order';

/**
 * `client_order_key` is a caller-chosen string carrying a GLOBAL unique index,
 * and checkout looked it up directly and returned the matching order — which
 * carries the customer's name, phone, email and delivery address, all of which
 * the checkout response returns in full.
 *
 * So anyone who guessed or reused a key another customer had already used
 * received that customer's order back. A PII disclosure needing nothing but a
 * plausible string, entirely under the caller's control.
 */

describe('the idempotency key is scoped to the customer', () => {
  it('gives two customers different keys for the same string', () => {
    // The whole finding: "order-1" from an attacker must not match "order-1"
    // from a victim.
    expect(scopeClientOrderKey('order-1', 'victim@example.com')).not.toBe(
      scopeClientOrderKey('order-1', 'attacker@example.com'),
    );
  });

  it('still matches the same customer retrying the same submission', () => {
    // Idempotency has to keep working, or a double-tap creates two orders.
    expect(scopeClientOrderKey('order-1', 'a@example.com')).toBe(
      scopeClientOrderKey('order-1', 'a@example.com'),
    );
  });

  it('is case- and whitespace-insensitive on the customer identifier', () => {
    // Otherwise one customer entering their address differently loses
    // idempotency and gets a duplicate order.
    const canonical = scopeClientOrderKey('k', 'a@example.com');
    expect(scopeClientOrderKey('k', 'A@Example.com')).toBe(canonical);
    expect(scopeClientOrderKey('k', '  a@example.com  ')).toBe(canonical);
  });

  it('keeps distinct submissions distinct for one customer', () => {
    expect(scopeClientOrderKey('order-1', 'a@example.com')).not.toBe(
      scopeClientOrderKey('order-2', 'a@example.com'),
    );
  });

  it('does not store the raw key', () => {
    // Callers put meaningful data in idempotency keys.
    const scoped = scopeClientOrderKey('basket-for-jane-doe-0771234567', 'jane@example.com');
    expect(scoped).not.toContain('jane');
    expect(scoped).not.toContain('0771234567');
    expect(scoped).toMatch(/^[0-9a-f]{64}$/);
  });

  it('cannot be collided by moving the boundary between key and customer', () => {
    // A naive `${scope}${key}` concatenation lets ("ab","c") and ("a","bc")
    // produce one digest, so two customers would share an idempotency identity.
    expect(scopeClientOrderKey('bc', 'a')).not.toBe(scopeClientOrderKey('c', 'ab'));
  });

  it('fits the stored varchar(80) column whatever the caller sends', () => {
    expect(scopeClientOrderKey('x'.repeat(80), 'a@example.com').length).toBeLessThanOrEqual(80);
  });

  it('resists a guessing sweep across many plausible keys', () => {
    // A victim's key space cannot be reached from another customer's scope.
    const victim = new Set(
      Array.from({ length: 200 }, (_, i) => scopeClientOrderKey(`order-${i}`, 'victim@example.com')),
    );
    for (let i = 0; i < 200; i++) {
      expect(victim.has(scopeClientOrderKey(`order-${i}`, 'attacker@example.com'))).toBe(false);
    }
  });
});

describe('the legacy contact-scoped idempotency is gone', () => {
  const useCase = readFileSync(
    join(__dirname, '../../apps/api/src/application/use-cases/commerce/CheckoutUseCase.ts'),
    'utf8',
  );

  it('no longer runs its own idempotency lookup', () => {
    // Checkout briefly had TWO idempotency systems: this one keyed on the
    // caller's email or phone, and the fenced checkout_idempotency claim keyed on
    // a verified principal. Two mechanisms disagreeing about who owns an
    // operation is worse than either alone, because which one answers depends on
    // call order. The claim is now the single authority.
    expect(useCase).not.toContain('scopeClientOrderKey');
    expect(useCase).not.toContain('findByClientKey');
  });

  it('keeps the customer scope for pricing only, never for ownership', () => {
    expect(useCase).toContain('customerScopeKey');
    expect(useCase).toContain('used only for pricing, never for ownership');
  });

  it('leaves the scoping helper unused rather than silently re-wired', () => {
    // The primitive survives in the domain for reference, but nothing in the
    // checkout path may call it.
    const order = readFileSync(
      join(__dirname, '../../apps/api/src/domain/commerce/Order.ts'),
      'utf8',
    );
    expect(order).toContain('scopeClientOrderKey');
  });
});
