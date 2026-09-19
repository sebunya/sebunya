import { describe, it, expect } from 'vitest';
import { allocateInteger, markovProbability, exactShapley, markovRemovalEffects, ruleWeights } from '../../apps/api/src/domain/measurement/Attribution';
import { classifyChannel } from '../../apps/api/src/domain/measurement/Channels';

const sum = (o: Record<string, bigint>) => Object.values(o).reduce((a, b) => a + b, 0n);
const J = (p: string[], c: boolean) => ({ path: p, converted: c });
const data = [J(['A'], true), J(['A'], false), J(['B'], true), J(['B'], false)];

describe('dossier §13.4 reference assertions', () => {
  it('allocates exactly, signed, with a stable tie break', () => {
    expect(sum(allocateInteger(100001n, { a: .4, b: .4, c: .2 }))).toBe(100001n);
    expect(sum(allocateInteger(-18001n, { a: 1, b: 2 }))).toBe(-18001n);
    expect(allocateInteger(1n, { b: 1, a: 1 })).toEqual({ b: 0n, a: 1n });
  });
  it('markov probabilities with redirect-to-NULL removal', () => {
    expect(markovProbability(data)).toBeCloseTo(.5, 12);
    expect(markovProbability(data, new Set(['A']))).toBeCloseTo(.25, 12);
  });
  it('shapley: symmetry, efficiency, baseline, dummy', () => {
    const r = exactShapley(data);
    expect(r.shapley.A).toBeCloseTo(.25, 12); expect(r.shapley.B).toBeCloseTo(.25, 12);
    expect(r.shapley.A + r.shapley.B).toBeCloseTo(r.full - r.baseline, 12);
    const direct = exactShapley([J([], true), J(['A'], true), J(['A'], false)]);
    expect(direct.baseline).toBeCloseTo(1 / 3, 12);
    expect(Object.values(direct.shapley).reduce((a, b) => a + b, 0)).toBeCloseTo(direct.full - direct.baseline, 12);
    expect(Math.abs(exactShapley([...data, J(['DUMMY'], false)]).shapley.DUMMY)).toBeLessThan(1e-12);
  });
  it('refuses an oversized exact coalition and an empty chain', () => {
    expect(() => exactShapley(Array.from({ length: 9 }, (_, i) => J([`c${i}`], true)))).toThrow(/budget/);
    expect(() => markovProbability([])).toThrow(/empty/);
  });
  it('removal effects are raw, not normalised', () => {
    const r = markovRemovalEffects(data);
    expect(r.effects.A).toBeCloseTo(.5, 12);
  });
});

describe('rule-based methods', () => {
  const at = new Date('2026-09-10T00:00:00Z');
  const t = (c: string, d: number) => ({ channel: c, at: new Date(at.getTime() - d * 86400000) });
  const path = [t('paid_search', 10), t('email', 5), t('organic_social', 2), t('direct', 0)];
  it('first / last / last non-direct', () => {
    expect(ruleWeights('first_touch', path, at)).toEqual({ paid_search: 1 });
    expect(ruleWeights('last_touch', path, at)).toEqual({ direct: 1 });
    expect(ruleWeights('last_non_direct', path, at)).toEqual({ organic_social: 1 });
    expect(ruleWeights('last_non_direct', [t('direct', 1)], at)).toEqual({ direct: 1 });
  });
  it('position-based 40/40/20, and 50/50 for two', () => {
    const w = ruleWeights('position_based', path, at)!;
    expect(w.paid_search).toBeCloseTo(.4); expect(w.direct).toBeCloseTo(.4); expect(w.email).toBeCloseTo(.1);
    expect(ruleWeights('position_based', path.slice(0, 2), at)).toEqual({ paid_search: .5, email: .5 });
  });
  it('time decay halves per half-life and sums to one', () => {
    const w = ruleWeights('time_decay', [t('a', 7), t('b', 0)], at)!;
    expect(w.b / w.a).toBeCloseTo(2); expect(w.a + w.b).toBeCloseTo(1);
  });
  it('same-channel touches combine; no touch is UNATTRIBUTED', () => {
    expect(ruleWeights('linear', [t('x', 3), t('y', 2), t('x', 1)], at)!.x).toBeCloseTo(2 / 3);
    expect(ruleWeights('linear', [], at)).toBeNull();
  });
});

describe('channel classification', () => {
  it('click ids beat utm, utm beats referrer', () => {
    expect(classifyChannel({ clickIdTypes: ['gclid'], medium: 'email' })).toBe('paid_search');
    expect(classifyChannel({ clickIdTypes: ['fbclid'] })).toBe('paid_social');
    expect(classifyChannel({ medium: 'cpc' })).toBe('paid_search');
    expect(classifyChannel({ source: 'whatsapp' })).toBe('whatsapp');
    expect(classifyChannel({ referrerHost: 'www.google.com' })).toBe('organic_search');
    expect(classifyChannel({ referrerHost: 'l.facebook.com' })).toBe('organic_social');
    expect(classifyChannel({ referrerHost: 'jumia.ug' })).toBe('referral');
    expect(classifyChannel({})).toBe('direct');
  });
});
