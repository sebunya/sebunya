import { describe, expect, it } from 'vitest';
import { goldieArm, ARM_KEY, launcherSubline, SUBLINE_MAX, DEFAULT_SUBLINE, createHesitation, NUDGE_EXCLUDED } from '../../apps/web/src/lib/goldieAwareness';
import { goldieKey } from '../../apps/web/src/lib/goldieQuestions';
import { NAV_ITEM_KEY } from '../../apps/api/src/infrastructure/nav/NavTelemetryService';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };

describe('goldieArm: the motion experiment', () => {
  it('splits visitors and keeps each one in their arm', () => {
    const s = mem();
    expect(goldieArm(s, () => 0.2)).toBe('a');
    expect(goldieArm(s, () => 0.9)).toBe('a');
    expect(s.m.get(ARM_KEY)).toBe('a');
    expect(goldieArm(mem(), () => 0.7)).toBe('b');
  });
  it('blocked storage falls back to the moving arm without throwing', () => {
    expect(goldieArm({ getItem: () => { throw new Error('blocked'); }, setItem: () => undefined })).toBe('a');
    expect(goldieArm(null, () => 0.9)).toBe('b');
  });
  it('every key the experiment records is accepted by the nav telemetry', () => {
    for (const k of ['launch-a', 'launch-b', 'nudge-reread-a', 'nudge-still-b', 'nudge-copy-a']) expect(NAV_ITEM_KEY.test(goldieKey(k))).toBe(true);
  });
});

describe('launcherSubline: a second line that names the question', () => {
  const lines = [
    launcherSubline({ path: '/products/x', productName: 'GoldPlus Replacement Battery A03 CORE', phone: 'Samsung A03 Core' }),
    launcherSubline({ path: '/products/x', productName: 'GoldPlus Replacement Battery A03 CORE', phone: 'Samsung Galaxy A03 Core 2021 edition' }),
    launcherSubline({ path: '/products/x', productName: 'GoldPlus GP-GAN01 65W GaN Fast Charger' }),
    launcherSubline({ path: '/products/x', productName: 'GoldPlus GP-W2 (PD-W2) Power Bank' }),
    launcherSubline({ path: '/products/x', productName: 'GoldPlus GP-L03 Lightning Cable' }),
    launcherSubline({ path: '/products/x', productName: 'GoldPlus Memory Card 32GB' }),
    launcherSubline({ path: '/phone-batteries', phone: 'Tecno Spark 10' }),
    launcherSubline({ path: '/power/chargers' }),
    launcherSubline({ path: '/delivery', todayOpen: true }),
    launcherSubline({ path: '/' }),
  ];
  it('names the question for the page', () => {
    expect(lines[0]).toBe('Ask if it fits your phone');
    expect(launcherSubline({ path: '/products/x', productName: 'Battery BL-5C', phone: 'Nokia 105' })).toBe('Fits your Nokia 105?');
    expect(lines[2]).toBe('Ask what it charges fast');
    expect(lines[8]).toBe('Ask if it can come today');
    expect(lines[9]).toBe(DEFAULT_SUBLINE);
  });
  it('never runs past the phone pill', () => {
    for (const l of lines) expect(l.length, l).toBeLessThanOrEqual(SUBLINE_MAX);
  });
});

describe('createHesitation: glint when the shopper looks stuck, not on a clock', () => {
  const VH = 800, DOC = 4000;
  it('scrolling back up to re-read fires once', () => {
    const h = createHesitation(0);
    expect(h.scroll(1200, VH, DOC, 9000)).toBeNull();
    expect(h.scroll(1500, VH, DOC, 10000)).toBeNull();
    expect(h.scroll(700, VH, DOC, 11000)).toBe('reread');
    expect(h.scroll(0, VH, DOC, 12000)).toBeNull();
  });
  it('a short wiggle or a scroll back at the top of the page does not count', () => {
    const h = createHesitation(0);
    h.scroll(300, VH, DOC, 9000);
    expect(h.scroll(0, VH, DOC, 10000)).toBeNull();
    const g = createHesitation(0); g.scroll(1600, VH, DOC, 9000);
    expect(g.scroll(1300, VH, DOC, 10000)).toBeNull();
  });
  it('nothing fires in the first seconds on the page', () => {
    const h = createHesitation(0);
    h.scroll(2000, VH, DOC, 1000);
    expect(h.scroll(0, VH, DOC, 2000)).toBeNull();
    expect(h.copy(3000)).toBeNull();
    expect(h.copy(9000)).toBe('copy');
  });
  it('going still counts only while the page is visible', () => {
    const h = createHesitation(0);
    expect(h.tick(20000, false)).toBeNull();
    expect(h.tick(30000, true)).toBeNull();
    expect(h.tick(34001, true)).toBe('still');
    const g = createHesitation(0); g.activity(10000);
    expect(g.tick(20000, true)).toBeNull();
  });
  it('task pages never get nudged', () => {
    for (const p of ['/checkout', '/cart', '/battery-finder', '/review', '/account/orders']) expect(NUDGE_EXCLUDED.test(p), p).toBe(true);
    for (const p of ['/', '/products/x', '/power/chargers']) expect(NUDGE_EXCLUDED.test(p), p).toBe(false);
  });
});
