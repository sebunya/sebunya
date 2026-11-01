import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VoteOnReviewUseCase } from '../../apps/api/src/application/use-cases/reviews/OrderReviewUseCases';

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const RID = '0f1e2d3c-4b5a-4978-8a9b-0c1d2e3f4a5b';

describe('review helpful votes (gap #10)', () => {
  it('stores a peppered hash of the visit token, never the token', async () => {
    const seen: any[] = [];
    const uc = new VoteOnReviewUseCase({ recordVote: async (v: any) => { seen.push(v); return 'recorded'; } } as never, 'pepper');
    expect(await uc.execute({ reviewId: RID, voterKey: 'gpv.signed.token', vote: 'helpful' })).toBe('recorded');
    expect(seen[0].voterIdentityHash).toMatch(/^[0-9a-f]{64}$/);
    expect(seen[0].voterIdentityHash).not.toContain('gpv');
    // The same visitor always maps to the same voter (one vote each).
    await uc.execute({ reviewId: RID, voterKey: 'gpv.signed.token', vote: 'not_helpful' });
    expect(seen[1].voterIdentityHash).toBe(seen[0].voterIdentityHash);
  });

  it('refuses a bad id, a missing visitor or an unknown vote without touching the database', async () => {
    let called = false;
    const uc = new VoteOnReviewUseCase({ recordVote: async () => { called = true; return 'recorded'; } } as never, 'p');
    expect(await uc.execute({ reviewId: 'x', voterKey: 'k', vote: 'helpful' })).toBe('invalid');
    expect(await uc.execute({ reviewId: RID, voterKey: '', vote: 'helpful' })).toBe('invalid');
    expect(await uc.execute({ reviewId: RID, voterKey: 'k', vote: 'love' })).toBe('invalid');
    expect(called).toBe(false);
  });

  it('only published reviews take votes, most helpful are listed first', () => {
    const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleReviewRepository.ts');
    expect(repo).toContain("eq(reviews.id, input.reviewId), eq(reviews.status, 'published')");
    expect(repo).toContain('.orderBy(desc(helpful), desc(reviews.createdAt))');
  });

  it('the product page posts through the same-origin relay, and works without JavaScript', () => {
    const pdp = read('apps/web/src/pages/products/[slug].astro');
    expect(pdp).toContain('<form method="POST" action="/api/reviews/vote" data-review-vote>');
    const relay = read('apps/web/src/pages/api/reviews/vote.ts');
    expect(relay).toContain("'x-gp-visit': visit");
    expect(relay).toContain('readClientAddress(context)'); // attributed to the visitor, so the API's limit applies
    expect(relay).toContain('return redirect(/^\\/products\\/[a-z0-9-]+$/i.test(back)');
  });

  it('the API counts a vote only from a visit token we signed (an unchecked header let a script vote endlessly)', () => {
    const route = read('apps/api/src/interfaces/http/routes/commerce.ts');
    expect(route).toMatch(/const voterKey = hashVisitToken\(c\.req\.header\('x-gp-visit'\) \?\? ''\) \?\? '';/);
  });
});
