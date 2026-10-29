import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { loyaltyEarnSourceFromOrder } from '../../apps/api/src/domain/loyalty/LoyaltyEarnEligibility';

const read = (p: string) => readFileSync(p, 'utf8');

describe('orders placed signed out earn for the verified owner of the phone (2026-10-29)', () => {
  const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleOrderRepository.ts');
  const fn = repo.slice(repo.indexOf('async findLoyaltyEarnSource('), repo.indexOf('async findAll('));

  it('the vesting source falls back to the account whose VERIFIED phone is the order phone', () => {
    expect(fn).toContain('customerPhone: orders.customerPhone');
    expect(fn).toContain('if (row && !row.userId) row.userId = await this.verifiedOwnerOfPhone(row.customerPhone)');
    expect(fn).toContain('phone_verified_at is not null and phone = ${e164}');
    // Every Ugandan spelling of the number reaches the same E.164 users.phone holds.
    expect(fn).toContain('normalizeUgandanPhone(phone)?.e164');
  });

  it('once owned, a signed-out order follows the same earn rule as a signed-in one', () => {
    const base = { totalUgx: 50_000, paymentStatus: 'paid', paymentMethod: 'pesapal', status: 'delivered', buyerType: 'retail' };
    expect(loyaltyEarnSourceFromOrder({ ...base, userId: null })).toBeNull();
    expect(loyaltyEarnSourceFromOrder({ ...base, userId: 'u1' })).toEqual({ userId: 'u1', totalUgx: 50_000 });
    expect(loyaltyEarnSourceFromOrder({ ...base, userId: 'u1', buyerType: 'wholesale' })).toBeNull();
  });

  it('no customer-facing copy still says a signed-out order never earns', () => {
    for (const p of ['docs/content/guides/101-goldplus-loyalty-points-explained.md', 'apps/web/src/pages/loyalty-terms.astro', 'apps/web/src/pages/account/loyalty.astro']) {
      const s = read(p);
      expect(s, p).not.toMatch(/or the order will not earn|Guest orders cannot be credited|must be signed in when you place/);
      expect(s, p).toMatch(/verified/);
    }
  });
});
