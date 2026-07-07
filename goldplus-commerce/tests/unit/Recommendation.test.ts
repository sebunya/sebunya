import { describe, expect, it } from 'vitest';
import {
  scoreCoOccurrences,
  rankPersonalized,
  finalizeRecommendations,
  blendWithFallback,
  PersonalizationSource,
  ScoredProduct,
} from '../../apps/api/src/domain/recommendation/Recommendation';

describe('scoreCoOccurrences (normalised similarity)', () => {
  it('ranks a tightly-related niche item above a co-occurring blockbuster', () => {
    // Anchor viewed by 100 people.
    // Niche item: co-viewed 20 times, only 25 total viewers -> highly related.
    // Blockbuster: co-viewed 30 times, but 5000 total viewers -> weak signal.
    const scored = scoreCoOccurrences(100, [
      { productId: 'niche', coCount: 20, candidateSupport: 25 },
      { productId: 'blockbuster', coCount: 30, candidateSupport: 5000 },
    ]);
    expect(scored[0].productId).toBe('niche');
    expect(scored[1].productId).toBe('blockbuster');
  });

  it('drops pairs below the minimum co-count as noise', () => {
    const scored = scoreCoOccurrences(50, [
      { productId: 'noise', coCount: 1, candidateSupport: 3 },
      { productId: 'real', coCount: 5, candidateSupport: 10 },
    ]);
    expect(scored.map((s) => s.productId)).toEqual(['real']);
  });

  it('never divides by zero for a zero-support anchor', () => {
    const scored = scoreCoOccurrences(0, [{ productId: 'x', coCount: 3, candidateSupport: 4 }]);
    expect(scored[0].score).toBeGreaterThan(0);
    expect(Number.isFinite(scored[0].score)).toBe(true);
  });

  it('returns results sorted by descending score', () => {
    const scored = scoreCoOccurrences(100, [
      { productId: 'a', coCount: 5, candidateSupport: 40 },
      { productId: 'b', coCount: 15, candidateSupport: 30 },
      { productId: 'c', coCount: 8, candidateSupport: 60 },
    ]);
    const scores = scored.map((s) => s.score);
    expect([...scores].sort((x, y) => y - x)).toEqual(scores);
  });
});

describe('rankPersonalized', () => {
  const similar = (ids: Array<[string, number]>): ScoredProduct[] => ids.map(([productId, score]) => ({ productId, score }));

  it('weights purchases above views and reinforces repeated signals', () => {
    const sources: PersonalizationSource[] = [
      { anchorProductId: 'A', anchorName: 'Cable', kind: 'view', ageDays: 0, similar: similar([['P1', 1]]) },
      { anchorProductId: 'B', anchorName: 'Charger', kind: 'purchase', ageDays: 0, similar: similar([['P1', 1], ['P2', 1]]) },
    ];
    const ranked = rankPersonalized(sources);
    // P1 gets both a view (1x) and purchase (4x) contribution -> ranks first.
    expect(ranked[0].productId).toBe('P1');
    // Its reason reflects the strongest (purchase) contribution.
    expect(ranked[0].reason).toContain('bought');
  });

  it('decays old interactions', () => {
    const recent: PersonalizationSource[] = [
      { anchorProductId: 'A', kind: 'view', ageDays: 0, similar: similar([['P', 1]]) },
    ];
    const old: PersonalizationSource[] = [
      { anchorProductId: 'A', kind: 'view', ageDays: 60, similar: similar([['P', 1]]) },
    ];
    expect(rankPersonalized(recent)[0].score).toBeGreaterThan(rankPersonalized(old)[0].score);
  });

  it('never recommends the anchor item back to the user', () => {
    const sources: PersonalizationSource[] = [
      { anchorProductId: 'A', kind: 'view', ageDays: 0, similar: similar([['A', 5], ['B', 1]]) },
    ];
    expect(rankPersonalized(sources).map((s) => s.productId)).toEqual(['B']);
  });
});

describe('finalizeRecommendations', () => {
  const scored = (ids: string[]): ScoredProduct[] => ids.map((productId, i) => ({ productId, score: ids.length - i }));

  it('excludes owned/anchor items and truncates to the limit', () => {
    const out = finalizeRecommendations(scored(['a', 'b', 'c', 'd']), {
      limit: 2,
      excludeIds: new Set(['a']),
    });
    expect(out.map((s) => s.productId)).toEqual(['b', 'c']);
  });

  it('enforces category diversity', () => {
    const category: Record<string, string> = { a: 'cables', b: 'cables', c: 'cables', d: 'audio' };
    const out = finalizeRecommendations(scored(['a', 'b', 'c', 'd']), {
      limit: 4,
      categoryOf: (id) => category[id],
      maxPerCategory: 2,
    });
    // Only two cables allowed, then audio.
    expect(out.map((s) => s.productId)).toEqual(['a', 'b', 'd']);
  });

  it('de-duplicates repeated product ids', () => {
    const out = finalizeRecommendations(
      [
        { productId: 'a', score: 3 },
        { productId: 'a', score: 2 },
        { productId: 'b', score: 1 },
      ],
      { limit: 5 }
    );
    expect(out.map((s) => s.productId)).toEqual(['a', 'b']);
  });
});

describe('blendWithFallback (cold start)', () => {
  it('keeps personalised results first, then fills from trending without duplicates', () => {
    const primary: ScoredProduct[] = [{ productId: 'p1', score: 9 }];
    const fallback: ScoredProduct[] = [
      { productId: 'p1', score: 5 },
      { productId: 't1', score: 4 },
      { productId: 't2', score: 3 },
    ];
    const out = blendWithFallback(primary, fallback, { limit: 3, excludeIds: new Set(['t2']) });
    expect(out.map((s) => s.productId)).toEqual(['p1', 't1']);
  });

  it('returns only trending for a brand-new visitor with no history', () => {
    const out = blendWithFallback([], [{ productId: 't1', score: 4 }, { productId: 't2', score: 3 }], { limit: 5 });
    expect(out.map((s) => s.productId)).toEqual(['t1', 't2']);
  });
});
