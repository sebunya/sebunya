import { Hono, type Context } from 'hono';
import { PERMISSIONS } from '@goldplus/shared';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import {
  validateBatteryCompatInput,
  BATTERY_COMPAT_STATUSES,
  BATTERY_EVIDENCE_SOURCES,
} from '../../../../application/use-cases/seo-growth/BatteryCompatibilityUseCases';
import {
  validateStorageTest,
  storageEvidenceState,
  STORAGE_TEST_METHODS,
} from '../../../../application/use-cases/seo-growth/StorageTestUseCases';
import {
  validateLifecycleDecision,
  rejectBlanketRedirect,
  allowedDispositionsFor,
  suggestedDisposition,
  LIFECYCLE_STATES,
  LIFECYCLE_DISPOSITIONS,
  type LifecycleState,
} from '../../../../application/use-cases/seo-growth/ProductLifecycleSeoUseCases';

/**
 * Catalogue intelligence admin API (migration 0119): battery compatibility,
 * storage-capacity tests and product lifecycle SEO decisions.
 *
 * Every mutation is evidence-gated in the use case, then audited. Nothing
 * here decides anything automatically: the review queues surface work, an
 * operator records the decision.
 */

const routes = new Hono();

routes.use('*', authMiddleware);

const ok = (c: Context, data: unknown, status = 200) => c.json({ success: true, data }, status as 200);
const bad = (c: Context, code: string, message: string, status = 400) =>
  c.json({ success: false, error: { code, message } }, status as 400);
const json = async (c: Context): Promise<any | null> => c.req.json().catch(() => null);
const actorId = (c: Context): string => (c.get('user') as any).id as string;
const repo = () => Registry.getInstance().seoCatalogueRepo;

/** Platform audit trail — every admin mutation here is recorded. */
const audit = async (c: Context, action: string, detail: Record<string, unknown>): Promise<void> => {
  await Registry.getInstance().createAuditLogUseCase.execute({
    actorId: actorId(c),
    action,
    entity: 'seo_catalogue',
    entityId: String(detail.id ?? detail.productId ?? ''),
    newState: detail,
  });
};

// ── Vocabulary (drives generic admin form rendering) ────────────────────────

routes.get('/vocabulary', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) =>
  ok(c, {
    batteryStatuses: BATTERY_COMPAT_STATUSES,
    batteryEvidenceSources: BATTERY_EVIDENCE_SOURCES,
    storageMethods: STORAGE_TEST_METHODS,
    lifecycleStates: LIFECYCLE_STATES,
    lifecycleDispositions: LIFECYCLE_DISPOSITIONS,
    allowedDispositions: Object.fromEntries(
      LIFECYCLE_STATES.map((s) => [s, allowedDispositionsFor(s)]),
    ),
    suggestedDispositions: Object.fromEntries(
      LIFECYCLE_STATES.map((s) => [s, suggestedDisposition(s)]),
    ),
  }));

// ── Battery compatibility ───────────────────────────────────────────────────

routes.get('/battery', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const [items, verified, unmatched] = await Promise.all([
    repo().listBatteryCompat({ status: c.req.query('status') || undefined }),
    repo().countVerifiedBatteryCompat(),
    repo().listUnmatchedFinderQueries(30, 25),
  ]);
  return ok(c, { items, verifiedCount: verified, unmatchedQueries: unmatched });
});

routes.post('/battery', requirePermissions([PERMISSIONS.SEO_METADATA_MANAGE]), async (c) => {
  const body = await json(c);
  if (!body) return bad(c, 'BAD_JSON', 'Body must be JSON.');
  const validation = validateBatteryCompatInput(body);
  if (!validation.ok) return bad(c, validation.code, validation.message, validation.code === 'EVIDENCE_REQUIRED' ? 422 : 400);
  const row = await repo().upsertBatteryCompat(validation.input as never, actorId(c));
  await audit(c, 'SEO_BATTERY_COMPAT_RECORDED', {
    id: row?.id, status: validation.input.status, evidenceSource: validation.input.evidenceSource ?? null,
  });
  return ok(c, row, 201);
});

routes.delete('/battery/:id', requirePermissions([PERMISSIONS.SEO_METADATA_MANAGE]), async (c) => {
  const done = await repo().deleteBatteryCompat(c.req.param('id') ?? '');
  if (!done) return bad(c, 'NOT_FOUND', 'Compatibility record not found.', 404);
  await audit(c, 'SEO_BATTERY_COMPAT_DELETED', { id: c.req.param('id') });
  return ok(c, { deleted: true });
});

// ── Storage tests ───────────────────────────────────────────────────────────

routes.get('/storage', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const [tests, coverage] = await Promise.all([
    repo().listStorageTests(c.req.query('productId') || undefined),
    repo().storageCoverage(),
  ]);
  // A product with zero tests is reported as NOT_TESTED — never omitted and
  // never implied to be fine.
  const withState = coverage.map((row: any) => ({
    ...row,
    evidenceState: storageEvidenceState(
      Array.from({ length: row.passes ?? 0 }, () => ({ result: 'PASS' }))
        .concat(Array.from({ length: row.failures ?? 0 }, () => ({ result: 'FAIL' })))
        .concat(Array.from({ length: row.inconclusive ?? 0 }, () => ({ result: 'INCONCLUSIVE' }))),
    ),
  }));
  return ok(c, {
    tests,
    coverage: withState,
    notTested: withState.filter((r: any) => r.evidenceState === 'NOT_TESTED').length,
  });
});

routes.post('/storage', requirePermissions([PERMISSIONS.SEO_METADATA_MANAGE]), async (c) => {
  const body = await json(c);
  if (!body) return bad(c, 'BAD_JSON', 'Body must be JSON.');
  const validation = validateStorageTest(body);
  if (!validation.ok) return bad(c, validation.code, validation.message, validation.code === 'EVIDENCE_REQUIRED' ? 422 : 400);
  const row = await repo().addStorageTest(validation.input, actorId(c));
  await audit(c, 'SEO_STORAGE_TEST_RECORDED', {
    id: row?.id, productId: validation.input.productId, result: validation.input.result,
  });
  return ok(c, row, 201);
});

// ── Product lifecycle ───────────────────────────────────────────────────────

routes.get('/lifecycle', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const [items, queue] = await Promise.all([
    repo().listLifecycle({
      disposition: c.req.query('disposition') || undefined,
      state: c.req.query('state') || undefined,
    }),
    repo().lifecycleReviewQueue(100),
  ]);
  return ok(c, { items, reviewQueue: queue });
});

routes.post('/lifecycle', requirePermissions([PERMISSIONS.SEO_REDIRECTS_MANAGE]), async (c) => {
  const body = await json(c);
  if (!body) return bad(c, 'BAD_JSON', 'Body must be JSON.');
  const decisions = Array.isArray(body.decisions) ? body.decisions : [body];
  const blanket = rejectBlanketRedirect(decisions);
  if (!blanket.ok) return bad(c, 'BLANKET_REDIRECT', blanket.message ?? 'Blanket redirect refused.', 422);

  // Validate EVERY decision before writing ANY of them. Validating inside the
  // write loop meant a refusal at decision 3 left decisions 1 and 2 already
  // applied, including live redirects, while the operator read a 422 and
  // reasonably believed nothing had been saved.
  const validated: Array<ReturnType<typeof validateLifecycleDecision> & { ok: true }> = [];
  for (const decision of decisions) {
    const validation = validateLifecycleDecision(decision);
    if (!validation.ok) {
      return bad(
        c,
        validation.code,
        `${validation.message} (product ${decision.productId ?? 'unknown'})`,
        ['SUCCESSOR_REQUIRED', 'RATIONALE_REQUIRED', 'DISPOSITION_NOT_DEFENSIBLE'].includes(validation.code) ? 422 : 400,
      );
    }
    validated.push(validation as never);
  }

  const saved: unknown[] = [];
  for (const validation of validated) {
    const row = await repo().upsertLifecycle(validation.input, actorId(c));
    saved.push(row);
    await audit(c, 'SEO_PRODUCT_LIFECYCLE_DECIDED', {
      productId: validation.input.productId,
      state: validation.input.state,
      disposition: validation.input.disposition,
      successorProductId: validation.input.successorProductId ?? null,
    });
  }
  return ok(c, { saved: saved.length, items: saved }, 201);
});

routes.get('/lifecycle/allowed', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const state = String(c.req.query('state') ?? '') as LifecycleState;
  if (!LIFECYCLE_STATES.includes(state)) return bad(c, 'BAD_INPUT', 'Unknown lifecycle state.');
  return ok(c, { state, allowed: allowedDispositionsFor(state), suggested: suggestedDisposition(state) });
});

export default routes;
