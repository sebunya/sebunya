import { Hono } from 'hono';
import { PERMISSIONS, ApiResponse } from '@goldplus/shared';
import { Registry } from '../../../../infrastructure/Registry';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import {
  DELIVERY_CONFIG_REGISTRY,
  LAUNCH_KEYS,
  validateConfigValue,
} from '../../../../domain/delivery/DeliveryConfigRegistry';
import { missingLaunchKeys } from '../../../../domain/delivery/DeliveryModel';
import { VARIANCE_REASONS } from '../../../../domain/delivery/DeliveryVariance';

/**
 * Delivery admin (brief v7, stages A–B).
 *
 * The Control Centre proper is stage E. What lives here now is the part that
 * cannot wait: the rider-cost entry path, without which the calibration in
 * PART 4 never starts, and a read of the launch-value state so the team can
 * see exactly what is blocking activation.
 *
 * Guard strings come from the PERMISSIONS vocabulary. Reading the setup state
 * is a report; entering a cost figure that will feed pricing is a mutation.
 */
// audit-exempt: the one write here (actual-cost) is audited inside
// RecordActualRiderCostUseCase, which records the before and after values —
// auditing again at the route would double-log and would put the audit in the
// wrong layer. The other POST validates a value without saving anything.
const routes = new Hono();
routes.use('*', authMiddleware);

/**
 * What is stopping the module quoting. Six unset values is a message on a
 * dashboard, not a blocker for a whole build — this is that message.
 */
routes.get('/setup', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const registry = Registry.getInstance();
  const [origins] = (await (await import('../../../../infrastructure/db/client')).db.execute(
    (await import('drizzle-orm')).sql`select count(*) filter (where active)::int as active, count(*)::int as total from delivery_origin`,
  )) as unknown as Array<{ active: number; total: number }>;
  const [corridors] = (await (await import('../../../../infrastructure/db/client')).db.execute(
    (await import('drizzle-orm')).sql`
      select count(*)::int as areas,
             count(*) filter (where access_mode = 'water')::int as water,
             count(*) filter (where not serviceable)::int as unserviceable
      from delivery_corridor`,
  )) as unknown as Array<{ areas: number; water: number; unserviceable: number }>;

  // The launch values live in the config tables; none are set yet, so this
  // reports every one as missing rather than inventing a value to show.
  const live = await registry.deliveryConfigReader.currentValues().catch(() => ({} as Record<string, string>));
  const numeric: Record<string, number> = {};
  for (const [k, v] of Object.entries(live)) {
    const n = Number(v);
    if (Number.isFinite(n)) numeric[k] = n;
  }
  const missing = missingLaunchKeys(numeric);

  return c.json({
    success: true,
    data: {
      quotingEnabled: missing.length === 0 && origins.active > 0,
      blockedBy: missing.length > 0 ? 'CONFIG_INCOMPLETE' : origins.active === 0 ? 'NO_ACTIVE_ORIGIN' : null,
      launchValues: LAUNCH_KEYS.map((key) => {
        const entry = DELIVERY_CONFIG_REGISTRY.find((e) => e.key === key)!;
        return {
          key,
          label: entry.label,
          unit: entry.unit,
          help: entry.help,
          value: live[key] ?? null,
          set: !missing.includes(key),
        };
      }),
      origins,
      corridors,
    },
  });
});

/**
 * Record what a delivery actually cost.
 *
 * ORDERS_MANAGE rather than a reporting right: this figure feeds the margin
 * report and every future recalibration, so it is a mutation of pricing input,
 * not an observation.
 */
routes.post('/orders/:orderId/actual-cost', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const raw = Number(body?.actualRiderCostUgx);
  const result = await Registry.getInstance().recordActualRiderCostUseCase.execute({
    orderId: String(c.req.param('orderId') ?? ''),
    actualRiderCostUgx: Number.isFinite(raw) ? raw : Number.NaN,
    actorId: (c.get('user') as { id: string }).id,
    note: typeof body?.note === 'string' ? body.note.slice(0, 500) : null,
  });
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 400);
  }
  return c.json({ success: true, data: result.row });
});

/**
 * The ops queue. Two lists that both mean "an observation the model will not
 * get unless someone acts", which is why they sit together rather than in
 * separate corners of the back office.
 */
routes.get('/awaiting-cost', requirePermissions([PERMISSIONS.ORDERS_READ]), async (c) => {
  const registry = Registry.getInstance();
  const [awaitingCost, skippedMirrors] = await Promise.all([
    registry.listDeliveriesAwaitingCostUseCase.execute(100),
    // Not fatal, never auto-retried — but loud enough to act on.
    registry.deliveryCaptureRepo.listSkippedMirrors(100),
  ]);
  return c.json({
    success: true,
    data: {
      awaitingCost,
      skippedMirrors,
      counts: { awaitingCost: awaitingCost.length, skippedMirrors: skippedMirrors.length },
      note:
        skippedMirrors.length > 0
          ? 'A skipped mirror means the delivery was recorded but the order never reached "delivered" — usually because it was not dispatched through the fulfilment states. Each one is an observation the model will not get.'
          : null,
    },
  });
});

/** The registry itself, so the Control Centre UI can generate from it. */
routes.get('/config-registry', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  return c.json({
    success: true,
    data: DELIVERY_CONFIG_REGISTRY.filter((e) => e.tier !== 3).map((e) => ({
      key: e.key,
      tier: e.tier,
      type: e.type,
      unit: e.unit,
      mandatory: e.mandatory,
      defaultValue: e.defaultValue,
      min: e.min ?? null,
      max: e.max ?? null,
      label: e.label,
      help: e.help,
    })),
  });
});

/** Validate a value without saving it, so the UI can refuse before publish. */
routes.post('/config-validate', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const key = String(body?.key ?? '');
  const value = String(body?.value ?? '');
  const result = validateConfigValue(key, value);
  return c.json({ success: true, data: result });
});

/* ── The launch wizard (brief "FINISH", PART 2) ──────────────────────────── */

/**
 * Alias-aware area search, restricted to areas that carry a band.
 *
 * Offering a place with no band would let an operator answer every question and
 * then be told at the end that their choice cannot anchor the arithmetic.
 */
routes.get('/wizard/areas', requirePermissions([PERMISSIONS.DELIVERY_CONFIG_READ]), async (c) => {
  const q = String(c.req.query('q') ?? '').trim();
  const areas = await Registry.getInstance().deliveryWizardAreaReader.searchQuotableAreas(q, 8);
  return c.json({ success: true, data: { areas } });
});

/**
 * Derive the launch values from the seven answers, showing the working.
 *
 * Computes only — nothing is saved. An operator can try three readings of their
 * own trip before committing to one.
 */
routes.post('/wizard/derive', requirePermissions([PERMISSIONS.DELIVERY_CONFIG_PROPOSE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const n = (v: unknown): number => {
    const parsed = Number(String(v ?? '').replace(/[,\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  };
  const freeRaw = String(body?.freeDeliveryThresholdUgx ?? '').trim();
  const result = await Registry.getInstance().deriveLaunchValuesUseCase.execute({
    areaSlug: String(body?.areaSlug ?? ''),
    roundTripMinutes: n(body?.roundTripMinutes),
    riderPayUgx: n(body?.riderPayUgx),
    handlingMinutes: n(body?.handlingMinutes),
    marginPercent: n(body?.marginPercent),
    minimumFeeUgx: n(body?.minimumFeeUgx),
    freeDeliveryThresholdUgx: freeRaw === '' || freeRaw.toLowerCase() === 'not_yet' ? null : n(freeRaw),
    riderLimitAreaSlug: String(body?.riderLimitAreaSlug ?? ''),
  });
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 400);
  }
  return c.json({ success: true, data: result.result });
});

/**
 * Save a derivation (or a direct expert-mode entry) as a DRAFT.
 *
 * Nothing takes effect from this. The next step is the preview, and publish
 * refuses a version that has not been previewed and confirmed.
 */
routes.post('/config/draft', requirePermissions([PERMISSIONS.DELIVERY_CONFIG_PROPOSE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const raw = body?.values;
  if (!raw || typeof raw !== 'object') {
    return c.json({ success: false, error: { code: 'INVALID_BODY', message: 'No values supplied.' } } satisfies ApiResponse<never>, 400);
  }
  const values: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const parsed = Number(String(v ?? '').replace(/[,\s]/g, ''));
    if (Number.isFinite(parsed)) values[k] = parsed;
  }
  const stringValues: Record<string, string> = {};
  for (const [k, v] of Object.entries((body?.stringValues ?? {}) as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim()) stringValues[k] = v.trim();
  }
  const result = await Registry.getInstance().draftLaunchValuesUseCase.execute({
    values,
    stringValues,
    actorId: (c.get('user') as { id: string }).id,
    reason: String(body?.reason ?? '').slice(0, 500) || 'Delivery launch values',
  });
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 400);
  }
  return c.json({ success: true, data: { versionId: result.versionId } });
});

/**
 * The mandatory preview: one real named area in every band, plus every recent
 * real order repriced, plus a plain-language impact summary.
 *
 * "An operator who answered 40 minutes when they meant 40 minutes each way will
 * see it here and nowhere else."
 */
routes.get('/config/:versionId/preview', requirePermissions([PERMISSIONS.DELIVERY_CONFIG_READ]), async (c) => {
  const result = await Registry.getInstance().previewDeliveryConfigUseCase.execute({
    versionId: String(c.req.param('versionId') ?? ''),
  });
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 404);
  }
  return c.json({ success: true, data: result.preview });
});

/** Publish. Refuses without an explicit preview confirmation. */
routes.post('/config/:versionId/publish', requirePermissions([PERMISSIONS.DELIVERY_CONFIG_PUBLISH]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const scheduledRaw = String(body?.scheduledFor ?? '').trim();
  const scheduled = scheduledRaw ? new Date(scheduledRaw) : null;
  if (scheduled && Number.isNaN(scheduled.getTime())) {
    return c.json({ success: false, error: { code: 'INVALID_SCHEDULE', message: 'That is not a valid date and time.' } } satisfies ApiResponse<never>, 400);
  }
  const result = await Registry.getInstance().publishDeliveryConfigUseCase.execute({
    versionId: String(c.req.param('versionId') ?? ''),
    actorId: (c.get('user') as { id: string }).id,
    previewConfirmed: body?.previewConfirmed === true,
    scheduledFor: scheduled,
  });
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 400);
  }
  return c.json({ success: true, data: result.version });
});

/** Version history, so an operator can see what was live and when. */
routes.get('/config/versions', requirePermissions([PERMISSIONS.DELIVERY_CONFIG_READ]), async (c) => {
  const registry = Registry.getInstance();
  const [versions, published] = await Promise.all([
    registry.deliveryConfigRepo.listVersions(50),
    registry.deliveryConfigRepo.publishedVersion(),
  ]);
  return c.json({ success: true, data: { versions, publishedVersionId: published?.id ?? null } });
});

/** Revert in one action: a NEW published version carrying the old values. */
routes.post('/config/revert', requirePermissions([PERMISSIONS.DELIVERY_CONFIG_PUBLISH]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = await Registry.getInstance().revertDeliveryConfigUseCase.execute({
    toVersionId: String(body?.toVersionId ?? ''),
    actorId: (c.get('user') as { id: string }).id,
    reason: String(body?.reason ?? ''),
  });
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 400);
  }
  return c.json({ success: true, data: result.version });
});

/* ── The variance write path (brief PART 5) ──────────────────────────────── */

/**
 * Apply a fee change to a PLACED order.
 *
 * Its own permission, because it changes what a specific customer has already
 * been told they will pay. The closed reason list is enforced in the domain, so
 * a route cannot widen it — `RIDER_COVERED_MORE_GROUND` is refused here exactly
 * as it is in a unit test.
 */
routes.post('/orders/:orderId/variance', requirePermissions([PERMISSIONS.DELIVERY_VARIANCE_APPLY]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const raw = Number(String(body?.newFeeUgx ?? '').replace(/[,\s]/g, ''));
  const result = await Registry.getInstance().applyDeliveryVarianceUseCase.execute({
    orderId: String(c.req.param('orderId') ?? ''),
    newFeeUgx: Number.isFinite(raw) ? raw : Number.NaN,
    reason: String(body?.reason ?? ''),
    note: typeof body?.note === 'string' ? body.note.slice(0, 500) : null,
    actorId: (c.get('user') as { id: string }).id,
  });
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 400);
  }
  return c.json({ success: true, data: result.variance });
});

/** Record the customer's answer. A decline may cancel without penalty. */
routes.post('/variance/:varianceId/agreement', requirePermissions([PERMISSIONS.DELIVERY_VARIANCE_APPLY]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = await Registry.getInstance().recordVarianceAgreementUseCase.execute({
    varianceId: String(c.req.param('varianceId') ?? ''),
    agreed: body?.agreed === true,
    cancelOrder: body?.cancelOrder === true,
    actorId: (c.get('user') as { id: string }).id,
  });
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 400);
  }
  return c.json({ success: true, data: result.variance });
});

/** Ops queue: nothing dispatches on these until the customer answers. */
routes.get('/variance/pending', requirePermissions([PERMISSIONS.ORDERS_READ]), async (c) => {
  const pending = await Registry.getInstance().listPendingVarianceAgreementsUseCase.execute(100);
  return c.json({
    success: true,
    data: {
      pending,
      count: pending.length,
      note:
        pending.length === 0
          ? 'No variance is waiting on a customer. Nothing is held up.'
          : 'These orders must not dispatch until the customer has agreed the changed fee.',
    },
  });
});

/** The closed list, so a UI can offer exactly the permitted reasons. */
routes.get('/variance/reasons', requirePermissions([PERMISSIONS.ORDERS_READ]), async (c) => {
  return c.json({
    success: true,
    data: {
      reasons: VARIANCE_REASONS,
      note: 'A rider covering more ground than predicted is NOT on this list and never will be. That is a modelling error, it goes to calibration, and GoldPlus absorbs it.',
    },
  });
});

/* ── The learning loop (brief PART 4) ────────────────────────────────────── */

/**
 * Run the nightly calibration on demand.
 *
 * PROPOSE right, because it produces proposals rather than applying anything.
 */
routes.post('/calibration/run', requirePermissions([PERMISSIONS.DELIVERY_CONFIG_PROPOSE]), async (c) => {
  const result = await Registry.getInstance().runNightlyCalibrationUseCase.execute();
  return c.json({ success: true, data: result });
});

/** The proposal queue. Empty is explained, never blank. */
routes.get('/calibration/proposals', requirePermissions([PERMISSIONS.DELIVERY_CONFIG_READ]), async (c) => {
  const registry = Registry.getInstance();
  const [proposals, counts] = await Promise.all([
    registry.deliveryCalibrationRepo.listProposals(String(c.req.query('status') ?? 'pending'), 200),
    registry.deliveryCalibrationRepo.counts(),
  ]);
  return c.json({
    success: true,
    data: {
      proposals,
      counts,
      note:
        proposals.length > 0
          ? null
          : counts.observations === 0
            ? 'Nothing to propose: no order has been delivered, so the model has no observations to learn from.'
            : 'Nothing to propose: no scope has reached the minimum sample size, or no minimum is set.',
    },
  });
});

/** Accept — refuses below the minimum rather than warning. */
routes.post('/calibration/proposals/:id/accept', requirePermissions([PERMISSIONS.DELIVERY_CONFIG_PUBLISH]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const edited = body?.editedValue === undefined || body?.editedValue === null ? null : Number(body.editedValue);
  const result = await Registry.getInstance().acceptCalibrationProposalUseCase.execute({
    proposalId: String(c.req.param('id') ?? ''),
    actorId: (c.get('user') as { id: string }).id,
    editedValue: edited,
  });
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 400);
  }
  return c.json({ success: true, data: { accepted: true } });
});

routes.post('/calibration/proposals/:id/reject', requirePermissions([PERMISSIONS.DELIVERY_CONFIG_PUBLISH]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const result = await Registry.getInstance().rejectCalibrationProposalUseCase.execute({
    proposalId: String(c.req.param('id') ?? ''),
    actorId: (c.get('user') as { id: string }).id,
    reason: String(body?.reason ?? ''),
  });
  if (!result.ok) {
    return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 400);
  }
  return c.json({ success: true, data: { rejected: true } });
});

/** Margin: quoted fee against what the rider was actually paid, per area. */
routes.get('/reports/margin', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  return c.json({ success: true, data: await Registry.getInstance().deliveryMarginReportUseCase.execute() });
});

/** Variance: how often a quote changed after placement, and what we absorbed. */
routes.get('/reports/variance', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  return c.json({ success: true, data: await Registry.getInstance().deliveryVarianceReportUseCase.execute() });
});

/**
 * The fallback rate. This is the EVIDENCE for deleting the legacy paths, so it
 * is a first-class report rather than a log line.
 */
routes.get('/reports/fallback-rate', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  return c.json({ success: true, data: await Registry.getInstance().deliveryFallbackRateUseCase.execute() });
});

export default routes;
