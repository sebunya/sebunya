import { describe, it, expect } from 'vitest';
import { computeNbaCandidates, kampalaCutoff, type NbaContext } from '@goldplus/shared';

/**
 * Server-side Next Best Action. The strip must say the ONE right thing for each
 * visitor — these pin the new-vs-existing-customer behaviour the header exists for.
 * The winner is the highest-scoring applicable candidate (the client filters
 * dismissed ids, sorts, and shows the top one).
 */

const base: NbaContext = {
  signedIn: false, visits: 1, cart: 0, points: 0, lastOrderDays: null, orderInTransit: false,
  beforeCutoff: true, minsToCutoff: 180, sunday: false, saleLive: false,
};
const top = (ctx: NbaContext) => computeNbaCandidates(ctx).sort((a, b) => b.score - a.score)[0];
const ids = (ctx: NbaContext) => computeNbaCandidates(ctx).map((x) => x.id);

describe('NBA — new vs existing customer', () => {
  it('a brand-new visitor is offered the reserved first-order discount', () => {
    expect(top({ ...base, visits: 1 }).id).toBe('welcome');
  });

  it('a returning (not signed-in) visitor gets the softer signup reminder, not welcome', () => {
    const t = top({ ...base, visits: 4 });
    expect(ids({ ...base, visits: 4 })).toContain('signup');
    expect(ids({ ...base, visits: 4 })).not.toContain('welcome');
    // cutoff (score 50 at >60 min) loses to signup (70) here
    expect(t.id).toBe('signup');
  });

  it('a signed-in customer never sees welcome or signup', () => {
    const set = ids({ ...base, signedIn: true, visits: 5 });
    expect(set).not.toContain('welcome');
    expect(set).not.toContain('signup');
  });
});

describe('NBA — cart is the highest-intent signal, even signed out', () => {
  it('a cart before the cutoff wins with the same-day urgency message', () => {
    expect(top({ ...base, cart: 2 }).id).toBe('cart-cutoff');
  });
  it('a cart after the cutoff falls back to the honest tomorrow promise', () => {
    expect(top({ ...base, cart: 2, beforeCutoff: false }).id).toBe('cart-later');
  });
  it('the CTA is always present on cart candidates (it must never truncate)', () => {
    expect(top({ ...base, cart: 1 }).cta).toBeTruthy();
  });
});

describe('NBA — signed-in signals', () => {
  it('an order out for delivery outranks everything', () => {
    expect(top({ ...base, signedIn: true, orderInTransit: true, cart: 3 }).id).toBe('transit');
  });
  it('a real points balance over 1,000 surfaces as money to spend', () => {
    const t = top({ ...base, signedIn: true, visits: 6, points: 1240, beforeCutoff: false });
    expect(t.id).toBe('points');
    expect(t.text).toContain('UGX 12,400'); // 1,240 pts x UGX 10
  });
  it('a long-idle customer is nudged to check their battery age', () => {
    expect(ids({ ...base, signedIn: true, lastOrderDays: 400 })).toContain('reorder');
  });
});

describe('NBA — always safe, never empty', () => {
  it('always yields at least the evergreen verify candidate', () => {
    const set = ids({ ...base, visits: 3, saleLive: false, beforeCutoff: false, sunday: true });
    expect(set.length).toBeGreaterThan(0);
    expect(set).toContain('verify');
  });
  it('Sunday tells the honest Monday story instead of a same-day promise', () => {
    const set = ids({ ...base, sunday: true, beforeCutoff: false });
    expect(set).toContain('sunday');
    expect(set).not.toContain('cutoff');
  });
  it('the same context is deterministic', () => {
    expect(ids({ ...base }).join()).toBe(ids({ ...base }).join());
  });
});

describe('kampalaCutoff (fixed UTC+3, no DST)', () => {
  it('mid-morning Monday UTC is before the cutoff', () => {
    // 2026-08-10 is a Monday; 09:00 UTC = 12:00 Kampala
    const c = kampalaCutoff(new Date('2026-08-10T09:00:00Z'));
    expect(c.sunday).toBe(false);
    expect(c.beforeCutoff).toBe(true);
    expect(c.minsToCutoff).toBe(5 * 60); // 12:00 -> 17:00
  });
  it('15:00 UTC (18:00 Kampala) is after the cutoff', () => {
    expect(kampalaCutoff(new Date('2026-08-10T15:00:00Z')).beforeCutoff).toBe(false);
  });
  it('Sunday is flagged', () => {
    // 2026-08-09 is a Sunday
    expect(kampalaCutoff(new Date('2026-08-09T09:00:00Z')).sunday).toBe(true);
  });
});
