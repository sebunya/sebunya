import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildCategoryCompetitorMatrix,
  matrixCoverage,
  matrixStateLabel,
  outrankGap,
  MATRIX_STATES,
  type MatrixCompetitor,
  type MatrixObservation,
} from '../../apps/api/src/application/use-cases/seo-growth/CategoryCompetitorMatrixUseCases';
import {
  validateWorkItem,
  summariseWorkQueue,
  workItemFromOpportunity,
  allowedTransitionsFrom,
  hasEvidenceLink,
  WORK_ITEM_STATES,
} from '../../apps/api/src/application/use-cases/seo-growth/SeoWorkQueueUseCases';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

// ── Category × competitor matrix ────────────────────────────────────────────

const COMPETITORS: MatrixCompetitor[] = [
  { id: 'jumia', canonicalName: 'Jumia Uganda', categoryOverlap: ['power', 'audio'] },
  { id: 'anker', canonicalName: 'Anker', categoryOverlap: ['power'] },
  { id: 'unknown', canonicalName: 'Unclassified Retailer', categoryOverlap: [] },
];

describe('the matrix keeps four states, never a boolean', () => {
  it('exposes exactly the four evidence states', () => {
    expect([...MATRIX_STATES].sort()).toEqual(['NOT_OBSERVED', 'NOT_RELEVANT', 'NOT_TESTED', 'OBSERVED']);
  });

  it('marks a never-sampled category NOT_TESTED, not NOT_OBSERVED', () => {
    const cells = buildCategoryCompetitorMatrix(['storage'], COMPETITORS, [], []);
    expect(cells.every((c) => c.state === 'NOT_TESTED' || c.state === 'NOT_RELEVANT')).toBe(true);
    expect(cells.find((c) => c.competitorId === 'unknown')!.state).toBe('NOT_TESTED');
  });

  it('marks a sampled category with no sighting NOT_OBSERVED', () => {
    const cells = buildCategoryCompetitorMatrix(
      ['power'], [COMPETITORS[0]], [], [{ category: 'power', observations: 12 }],
    );
    expect(cells[0].state).toBe('NOT_OBSERVED');
    expect(cells[0].categorySampleSize).toBe(12);
  });

  it('counts observations that matched no tracked competitor as evidence that we looked', () => {
    // 12 observations ran for power, none of them matched a tracked competitor.
    // Without the explicit sample sizes this would wrongly report NOT_TESTED.
    const withSizes = buildCategoryCompetitorMatrix(['power'], [COMPETITORS[0]], [], [{ category: 'power', observations: 12 }]);
    const without = buildCategoryCompetitorMatrix(['power'], [COMPETITORS[0]], []);
    expect(withSizes[0].state).toBe('NOT_OBSERVED');
    expect(without[0].state).toBe('NOT_TESTED');
  });

  it('marks a category outside a competitor’s recorded overlap NOT_RELEVANT', () => {
    const cells = buildCategoryCompetitorMatrix(['audio'], [COMPETITORS[1]], [], [{ category: 'audio', observations: 5 }]);
    expect(cells[0].state).toBe('NOT_RELEVANT');
  });

  it('never infers NOT_RELEVANT from an unknown overlap', () => {
    const cells = buildCategoryCompetitorMatrix(['audio'], [COMPETITORS[2]], [], [{ category: 'audio', observations: 5 }]);
    expect(cells[0].state).toBe('NOT_OBSERVED');
  });

  it('lets a real sighting override a stale NOT_RELEVANT classification', () => {
    const obs: MatrixObservation[] = [{ category: 'audio', competitorId: 'anker', rank: 3, observedAt: '2026-08-01T00:00:00Z' }];
    const cells = buildCategoryCompetitorMatrix(['audio'], [COMPETITORS[1]], obs, [{ category: 'audio', observations: 5 }]);
    expect(cells[0].state).toBe('OBSERVED');
    expect(cells[0].bestRank).toBe(3);
  });

  it('reports the best (lowest) rank across sightings', () => {
    const obs: MatrixObservation[] = [
      { category: 'power', competitorId: 'jumia', rank: 7, observedAt: '2026-08-01T00:00:00Z' },
      { category: 'power', competitorId: 'jumia', rank: 2, observedAt: '2026-08-02T00:00:00Z' },
    ];
    const cells = buildCategoryCompetitorMatrix(['power'], [COMPETITORS[0]], obs, [{ category: 'power', observations: 9 }]);
    expect(cells[0].bestRank).toBe(2);
    expect(cells[0].sightings).toBe(2);
    expect(cells[0].lastObservedAt).toBe('2026-08-02T00:00:00Z');
  });

  it('surfaces untested categories as explicit blind spots', () => {
    const cells = buildCategoryCompetitorMatrix(
      ['power', 'storage'], COMPETITORS, [], [{ category: 'power', observations: 4 }],
    );
    expect(matrixCoverage(cells).untestedCategories).toEqual(['storage']);
  });

  it('labels NOT_TESTED as ignorance, never as absence', () => {
    expect(matrixStateLabel('NOT_TESTED')).toMatch(/never sampled|do not know/i);
    expect(matrixStateLabel('NOT_OBSERVED')).toMatch(/sampled/i);
    expect(matrixStateLabel('NOT_TESTED')).not.toBe(matrixStateLabel('NOT_OBSERVED'));
  });
});

describe('outrank gaps never fabricate a zero', () => {
  it('returns null for a category that was never sampled', () => {
    const cells = buildCategoryCompetitorMatrix(['storage'], COMPETITORS, [], []);
    expect(outrankGap(cells, 'storage', null)).toBeNull();
  });

  it('lists only competitors observed ahead of us', () => {
    const obs: MatrixObservation[] = [
      { category: 'power', competitorId: 'jumia', rank: 2, observedAt: '2026-08-01T00:00:00Z' },
      { category: 'power', competitorId: 'anker', rank: 9, observedAt: '2026-08-01T00:00:00Z' },
    ];
    const cells = buildCategoryCompetitorMatrix(['power'], COMPETITORS, obs, [{ category: 'power', observations: 9 }]);
    const gap = outrankGap(cells, 'power', 5)!;
    expect(gap.ahead.map((a) => a.competitorId)).toEqual(['jumia']);
  });

  it('treats never-ranking ourselves as behind everyone observed', () => {
    const obs: MatrixObservation[] = [{ category: 'power', competitorId: 'anker', rank: 9, observedAt: '2026-08-01T00:00:00Z' }];
    const cells = buildCategoryCompetitorMatrix(['power'], COMPETITORS, obs, [{ category: 'power', observations: 9 }]);
    expect(outrankGap(cells, 'power', null)!.ahead).toHaveLength(1);
  });
});

// ── Work queue ──────────────────────────────────────────────────────────────

describe('the work queue refuses to call shipping a result', () => {
  it('cannot reach DONE without a measured outcome', () => {
    const v = validateWorkItem({ title: 'Rewrite power hub copy', state: 'DONE' });
    expect(v.ok === false && v.code).toBe('OUTCOME_REQUIRED');
    expect(v.ok === false && v.message).toMatch(/shipping is not the same as succeeding/i);
  });

  it('accepts NOT_MEASURED as an honest close', () => {
    const v = validateWorkItem({ title: 'Rewrite copy', state: 'DONE', outcome: 'NOT_MEASURED' });
    expect(v.ok).toBe(true);
  });

  it('requires evidence for an IMPROVED claim', () => {
    const v = validateWorkItem({ title: 'x', state: 'DONE', outcome: 'IMPROVED' });
    expect(v.ok === false && v.code).toBe('EVIDENCE_REQUIRED');
    const ok = validateWorkItem({ title: 'x', state: 'DONE', outcome: 'IMPROVED', outcomeNote: 'Avg position 14 -> 6 over 4 weeks (GSC).' });
    expect(ok.ok).toBe(true);
  });

  it('refuses an illegal state transition', () => {
    const v = validateWorkItem({ title: 'x', state: 'DONE', outcome: 'NO_CHANGE' }, { state: 'BACKLOG' });
    expect(v.ok === false && v.code).toBe('ILLEGAL_TRANSITION');
  });

  it('allows the legitimate path through to DONE', () => {
    expect(allowedTransitionsFrom('SHIPPED')).toContain('VALIDATING');
    expect(allowedTransitionsFrom('VALIDATING')).toContain('DONE');
    const v = validateWorkItem({ title: 'x', state: 'DONE', outcome: 'NO_CHANGE' }, { state: 'VALIDATING' });
    expect(v.ok).toBe(true);
  });

  it('makes DONE terminal', () => {
    expect(allowedTransitionsFrom('DONE')).toEqual([]);
  });

  it('every state is reachable in the transition table', () => {
    const reachable = new Set(WORK_ITEM_STATES.flatMap((s) => allowedTransitionsFrom(s)));
    for (const s of WORK_ITEM_STATES) {
      if (s === 'BACKLOG') continue; // the entry point
      expect(reachable.has(s), `${s} is unreachable`).toBe(true);
    }
  });
});

describe('the work queue summary never flatters itself', () => {
  it('reports an unknown improvement rate when nothing is complete', () => {
    const s = summariseWorkQueue([{ state: 'IN_PROGRESS' }, { state: 'SHIPPED' }]);
    expect(s.improvementRate).toBeNull();
  });

  it('counts shipped-but-unmeasured work as awaiting validation, not as success', () => {
    const s = summariseWorkQueue([{ state: 'SHIPPED' }, { state: 'VALIDATING', outcome: null }]);
    expect(s.awaitingValidation).toBe(2);
    expect(s.completed).toBe(0);
  });

  it('computes the rate over completed items only', () => {
    const s = summariseWorkQueue([
      { state: 'DONE', outcome: 'IMPROVED' },
      { state: 'DONE', outcome: 'NO_CHANGE' },
      { state: 'IN_PROGRESS' },
    ]);
    expect(s.completed).toBe(2);
    expect(s.improvementRate).toBe(0.5);
  });

  it('flags items with no link back to evidence', () => {
    expect(hasEvidenceLink({ title: 'x' })).toBe(false);
    expect(hasEvidenceLink({ title: 'x', gapId: 'g1' })).toBe(true);
    expect(summariseWorkQueue([{ state: 'BACKLOG' }, { state: 'BACKLOG', opportunityId: 'o1' }]).unevidenced).toBe(1);
  });
});

describe('promotion preserves the evidence chain', () => {
  it('carries the opportunity and gap ids onto the new item', () => {
    const draft = workItemFromOpportunity({ id: 'o1', title: 'Build a storage hub', gapId: 'g1', targetPath: '/storage' });
    expect(draft).toMatchObject({ opportunityId: 'o1', gapId: 'g1', targetUrl: '/storage', state: 'BACKLOG' });
    expect(hasEvidenceLink(draft)).toBe(true);
  });

  it('lands in BACKLOG — promoting is not deciding to do the work', () => {
    expect(workItemFromOpportunity({ id: 'o1', title: 't' }).state).toBe('BACKLOG');
  });
});

// ── Wiring ──────────────────────────────────────────────────────────────────

describe('work queue and matrix are wired end to end', () => {
  const routes = read('apps/api/src/interfaces/http/routes/admin/seo-workqueue.ts');
  const app = read('apps/api/src/interfaces/http/app.ts');
  const migration = read('apps/api/src/infrastructure/db/migrations/0120_seo_technical_governance.sql');

  it('enforces the DONE-needs-an-outcome rule at the data layer too', () => {
    expect(migration).toContain("state <> 'DONE' OR outcome IS NOT NULL");
  });

  it('registers migration 0120 with a monotonic timestamp', () => {
    const journal = JSON.parse(read('apps/api/src/infrastructure/db/migrations/meta/_journal.json'));
    const entry = journal.entries.find((e: any) => e.tag === '0120_seo_technical_governance');
    expect(entry).toBeTruthy();
    const prior = journal.entries.find((e: any) => e.idx === entry.idx - 1);
    expect(entry.when).toBeGreaterThan(prior.when);
  });

  it('guards every handler with a permission', () => {
    const handlers = routes.match(/routes\.(get|post|patch|delete)\(/g) ?? [];
    const guards = routes.match(/requirePermissions\(/g) ?? [];
    expect(handlers.length).toBeGreaterThan(0);
    expect(guards).toHaveLength(handlers.length);
  });

  it('audits every mutation', () => {
    for (const action of ['SEO_WORK_ITEM_CREATED', 'SEO_WORK_ITEM_UPDATED', 'SEO_WORK_ITEM_PROMOTED']) {
      expect(routes).toContain(action);
    }
  });

  it('validates transitions against the stored state, not the submitted one', () => {
    expect(routes).toContain('{ state: existing.state }');
  });

  it('mounts the routes', () => {
    expect(app).toContain("app.route('/admin/seo/workqueue', adminSeoWorkQueueRoutes)");
    expect(app).toContain("'/admin/seo/workqueue'");
  });

  it('offers only server-accepted transitions in the admin UI', () => {
    const page = read('apps/web/src/pages/admin/seo/work-queue.astro');
    expect(page).toContain('vocab.allowedTransitions');
    expect(page).toContain('Nothing completed yet — not 0%.');
  });

  it('keeps NOT TESTED visually distinct from absence in the matrix UI', () => {
    const page = read('apps/web/src/pages/admin/seo/category-matrix.astro');
    expect(page).toContain('NOT TESTED, we never looked');
    expect(page).toContain('Blind spots');
  });
});
