import { describe, expect, it } from 'vitest';
import { planStaleQueryPrune } from './staleQueryIdentities';

const rules: Record<string, string> = { 'shop gold': 'shopgold', shopgold: 'goldplus', goldplus: 'goldplus', 'gold plus': 'goldplus' };
const normalize = (q: string) => rules[q] ?? q;

describe('planStaleQueryPrune', () => {
  it('deletes a stale row whose correct identity is held by a correct row', () => {
    const plan = planStaleQueryPrune([
      { id: '1', query: 'gold plus', normalized_query: 'gold plus' },
      { id: '2', query: 'goldplus', normalized_query: 'goldplus' },
    ], normalize);
    expect(plan.stale.map((s) => s.row.id)).toEqual(['1']);
    expect(plan.skipped).toEqual([]);
  });
  it('a row deleted in the same pass does not vouch for another', () => {
    // A ('shop gold' stored as 'shop gold') now normalises to 'shopgold'; the only 'shopgold' row (B) is itself stale.
    const plan = planStaleQueryPrune([
      { id: 'A', query: 'shop gold', normalized_query: 'shop gold' },
      { id: 'B', query: 'shopgold', normalized_query: 'shopgold' },
      { id: 'C', query: 'goldplus', normalized_query: 'goldplus' },
    ], normalize);
    expect(plan.stale.map((s) => s.row.id)).toEqual(['B']);
    expect(plan.skipped.map((s) => s.row.id)).toEqual(['A']);
  });
  it('keeps correct rows', () => {
    expect(planStaleQueryPrune([{ id: 'C', query: 'goldplus', normalized_query: 'goldplus' }], normalize)).toEqual({ stale: [], skipped: [] });
  });
});
