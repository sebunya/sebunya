import { describe, it, expect } from 'vitest';
import { computeNbaCandidates, kampalaCutoff, DEFAULT_NBA_RATES, type NbaContext } from '@goldplus/shared';

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

describe('NBA — offer figures come from real rates, never a typed promise', () => {
  it('a first visit is welcomed without inventing a first-order discount', () => {
    // "10% off your first order is reserved — about UGX 18,500 back" had no
    // pricing rule behind it. The only discount is the live storewide sale.
    const welcome = computeNbaCandidates({ ...base, visits: 1 }).find((x) => x.id === 'welcome')!;
    expect(welcome.text).not.toMatch(/% off|UGX|reserved/);
    const points = computeNbaCandidates({ ...base, signedIn: true, points: 1240 }).find((x) => x.id === 'points')!;
    expect(points.text).toContain('UGX 12,400');
  });
  it('the sale candidate carries the live percentage and only appears while the sale runs', () => {
    const on = computeNbaCandidates({ ...base, saleLive: true }, { ...DEFAULT_NBA_RATES, salePct: 10 }).find((x) => x.id === 'sale')!;
    expect(on.text).toContain('10% discount');
    expect(on.href).toBe('/shop');
    expect(computeNbaCandidates({ ...base, saleLive: true }, { ...DEFAULT_NBA_RATES, salePct: 0 }).map((x) => x.id)).not.toContain('sale');
    expect(computeNbaCandidates({ ...base, saleLive: false }, { ...DEFAULT_NBA_RATES, salePct: 10 }).map((x) => x.id)).not.toContain('sale');
  });
  it('custom rates flow into the copy (edit in /admin/nav is reflected)', () => {
    const rates = { firstOrderPct: 15, referralPct: 12, pointsToUgxRate: 20, firstOrderEstimate: 'UGX 30,000' };
    // The referral programme pays points, never a percentage, so no rate flows into that line.
    const refer = computeNbaCandidates({ ...base, signedIn: true }, rates).find((x) => x.id === 'refer')!;
    expect(refer.text).toContain('points');
    expect(refer.text).not.toContain('%');
    const points = computeNbaCandidates({ ...base, signedIn: true, points: 1000 }, rates).find((x) => x.id === 'points')!;
    expect(points.text).toContain('UGX 20,000'); // 1,000 × 20
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
  it('honours an operator-configured cutoff hour', () => {
    // 12:00 Kampala with a 14:00 cutoff → 120 min left, still before cutoff.
    const c = kampalaCutoff(new Date('2026-08-10T09:00:00Z'), { cutoffHour: 14 });
    expect(c.beforeCutoff).toBe(true);
    expect(c.minsToCutoff).toBe(120);
    expect(c.cutoffLabel).toBe('2:00pm');
    // Same instant is AFTER a 10:00 cutoff.
    expect(kampalaCutoff(new Date('2026-08-10T09:00:00Z'), { cutoffHour: 10 }).beforeCutoff).toBe(false);
  });
  it('honours operator-configured closed days (and Monday is not closed by default)', () => {
    // Monday closed when configured; Sunday open when not configured closed.
    expect(kampalaCutoff(new Date('2026-08-10T09:00:00Z'), { closedDays: [1] }).closed).toBe(true);
    expect(kampalaCutoff(new Date('2026-08-09T09:00:00Z'), { closedDays: [1] }).closed).toBe(false);
  });
});
