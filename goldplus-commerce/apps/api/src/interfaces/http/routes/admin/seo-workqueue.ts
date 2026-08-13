import { Hono, type Context } from 'hono';
import { PERMISSIONS } from '@goldplus/shared';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import {
  validateWorkItem,
  summariseWorkQueue,
  workItemFromOpportunity,
  allowedTransitionsFrom,
  WORK_ITEM_STATES,
  WORK_ITEM_PRIORITIES,
  WORK_ITEM_OUTCOMES,
  type WorkItemState,
} from '../../../../application/use-cases/seo-growth/SeoWorkQueueUseCases';
import {
  buildCategoryCompetitorMatrix,
  matrixCoverage,
  outrankGap,
  MATRIX_STATES,
} from '../../../../application/use-cases/seo-growth/CategoryCompetitorMatrixUseCases';

/**
 * SEO work queue + category×competitor matrix API (migration 0120).
 *
 * The queue closes observation -> gap -> opportunity -> work item -> change ->
 * validation -> outcome. The matrix is DERIVED from recorded SERP
 * observations; it stores nothing of its own and invents nothing.
 */

const routes = new Hono();

routes.use('*', authMiddleware);

const ok = (c: Context, data: unknown, status = 200) => c.json({ success: true, data }, status as 200);
const bad = (c: Context, code: string, message: string, status = 400) =>
  c.json({ success: false, error: { code, message } }, status as 400);
const json = async (c: Context): Promise<any | null> => c.req.json().catch(() => null);
const actorId = (c: Context): string => (c.get('user') as any).id as string;
const repo = () => Registry.getInstance().seoWorkQueueRepo;

const audit = async (c: Context, action: string, detail: Record<string, unknown>): Promise<void> => {
  await Registry.getInstance().createAuditLogUseCase.execute({
    actorId: actorId(c),
    action,
    entity: 'seo_work_item',
    entityId: String(detail.id ?? ''),
    newState: detail,
  });
};

const camel = (row: any) => ({
  ...row,
  opportunityId: row?.opportunity_id ?? null,
  gapId: row?.gap_id ?? null,
  observationId: row?.observation_id ?? null,
});

// ── Vocabulary ──────────────────────────────────────────────────────────────

routes.get('/vocabulary', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) =>
  ok(c, {
    states: WORK_ITEM_STATES,
    priorities: WORK_ITEM_PRIORITIES,
    outcomes: WORK_ITEM_OUTCOMES,
    matrixStates: MATRIX_STATES,
    allowedTransitions: Object.fromEntries(WORK_ITEM_STATES.map((s) => [s, allowedTransitionsFrom(s)])),
  }));

// ── Work items ──────────────────────────────────────────────────────────────

routes.get('/items', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const [items, inbox] = await Promise.all([
    repo().listWorkItems({ state: c.req.query('state') || undefined, priority: c.req.query('priority') || undefined }),
    repo().unpromotedOpportunities(50),
  ]);
  return ok(c, { items, inbox, summary: summariseWorkQueue(items.map(camel)) });
});

routes.post('/items', requirePermissions([PERMISSIONS.SEO_EXPERIMENTS_MANAGE]), async (c) => {
  const body = await json(c);
  if (!body) return bad(c, 'BAD_JSON', 'Body must be JSON.');
  const validation = validateWorkItem(body);
  if (!validation.ok) return bad(c, validation.code, validation.message, validation.code === 'BAD_INPUT' ? 400 : 422);
  const row = await repo().createWorkItem(validation.input, actorId(c));
  await audit(c, 'SEO_WORK_ITEM_CREATED', { id: row?.id, title: validation.input.title, state: validation.input.state });
  return ok(c, row, 201);
});

routes.patch('/items/:id', requirePermissions([PERMISSIONS.SEO_EXPERIMENTS_MANAGE]), async (c) => {
  const body = await json(c);
  if (!body) return bad(c, 'BAD_JSON', 'Body must be JSON.');
  const existing = await repo().getWorkItem(c.req.param('id') ?? '');
  if (!existing) return bad(c, 'NOT_FOUND', 'Work item not found.', 404);
  // The transition and the DONE-needs-an-outcome rule are checked against the
  // item's CURRENT state, not the submitted one.
  const validation = validateWorkItem(
    { ...camel(existing), ...body, title: body.title ?? existing.title },
    { state: existing.state },
  );
  if (!validation.ok) {
    return bad(c, validation.code, validation.message, validation.code === 'BAD_INPUT' ? 400 : 422);
  }
  const row = await repo().updateWorkItem(existing.id, validation.input);
  await audit(c, 'SEO_WORK_ITEM_UPDATED', {
    id: existing.id, from: existing.state, to: validation.input.state, outcome: validation.input.outcome ?? null,
  });
  return ok(c, row);
});

routes.post('/items/promote', requirePermissions([PERMISSIONS.SEO_EXPERIMENTS_MANAGE]), async (c) => {
  const body = await json(c);
  if (!body?.opportunity) return bad(c, 'BAD_INPUT', 'An opportunity is required.');
  const draft = workItemFromOpportunity(body.opportunity);
  const validation = validateWorkItem(draft);
  if (!validation.ok) return bad(c, validation.code, validation.message, 422);
  const row = await repo().createWorkItem(validation.input, actorId(c));
  await audit(c, 'SEO_WORK_ITEM_PROMOTED', { id: row?.id, opportunityId: draft.opportunityId });
  return ok(c, row, 201);
});

// ── Category × competitor matrix (derived, stores nothing) ──────────────────

routes.get('/matrix', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const days = Math.min(Math.max(Number(c.req.query('days')) || 90, 1), 365);
  const [categories, competitors, observations, sampleSizes, ourRanks] = await Promise.all([
    repo().matrixCategories(),
    repo().matrixCompetitors(),
    repo().matrixObservations(days),
    repo().matrixCategorySampleSize(days),
    repo().ourBestRankByCategory(days),
  ]);

  const cells = buildCategoryCompetitorMatrix(
    categories,
    competitors.map((r: any) => ({
      id: String(r.id),
      canonicalName: String(r.canonical_name),
      categoryOverlap: Array.isArray(r.category_overlap) ? r.category_overlap.map(String) : [],
    })),
    observations.map((r: any) => ({
      category: String(r.category),
      competitorId: String(r.competitor_id),
      rank: r.rank === null || r.rank === undefined ? null : Number(r.rank),
      observedAt: new Date(r.observed_at).toISOString(),
      sightings: Number(r.sightings) || 1,
    })),
    sampleSizes,
  );

  const ourRankByCategory = new Map(ourRanks.map((r) => [r.category, r.bestRank]));
  const gaps = categories
    .map((cat) => outrankGap(cells, cat, ourRankByCategory.get(cat) ?? null))
    .filter((g): g is NonNullable<typeof g> => g !== null && g.ahead.length > 0);

  return ok(c, {
    windowDays: days,
    categories,
    competitors: competitors.map((r: any) => ({ id: String(r.id), canonicalName: String(r.canonical_name) })),
    cells,
    coverage: matrixCoverage(cells),
    outrankGaps: gaps,
  });
});

export default routes;
