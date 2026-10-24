import { Hono, type Context } from 'hono';
import { PERMISSIONS } from '@goldplus/shared';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { MEASUREMENT_CONFIG_REGISTRY, effectiveNumber, resolveUgxPerUsd, whatsappCostUgx } from '../../../../domain/measurement/MeasurementConfig';
import { HOLDOUT_PROGRAMMES } from '../../../../domain/measurement/Incrementality';
import { CONTROL_HELP, CONTROL_KEYS, MANUAL_CONTROL_KEYS } from '../../../../infrastructure/measurement/MmmDataset';
import { Ga4Reconciliation, HttpGa4Reader, careDeskAlarm } from '../../../../infrastructure/measurement/Ga4Reconciliation';
import { lastMeasurementNightly, runMeasurementNightlyOnce } from '../../../../infrastructure/scheduler/MeasurementNightlyTicker';
import { storeZip } from '../../../../infrastructure/measurement/storeZip';
import { GA4_REPORTS, type Ga4ReportKey } from '../../../../infrastructure/measurement/Ga4DailyPull';
import { MEDIUM_LABELS, PLACEMENT_MEDIA, PLACEMENT_TYPES } from '../../../../infrastructure/measurement/DrizzleMediaPlacementStore';

/**
 * Marketing mix modelling inputs, owned-channel holdouts, measurement settings and the GA4 reconciliation
 * (0203, 2026-10-23). Mounted at /admin/measurement/mmm.
 */
const routes = new Hono();
routes.use('*', authMiddleware);
const registry = () => Registry.getInstance();
const actorId = (c: Context) => (c.get('user') as { id?: string } | undefined)?.id ?? null;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const bad = (c: Context, message: string, status: 400 | 403 = 400) => c.json({ success: false, error: { code: 'BAD_REQUEST', message } }, status);

routes.get('/status', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const r = registry();
  const [readiness, nightly, counts, values, fxFeed, ga4Series] = await Promise.all([r.mmmDataset.readiness(), lastMeasurementNightly(), r.holdoutStore.assignmentCounts(), r.measurementConfig.values(), r.controlFeeds.latestFx(), r.ga4DailyPull.summary()]);
  const fx = resolveUgxPerUsd(values, fxFeed, new Date().toISOString().slice(0, 10));
  const whatsapp = whatsappCostUgx(values, fx.rate);
  const costs = { ugxPerUsd: fx.rate, fxBasis: fx.basis, fxDetail: fx.detail, smsUgx: effectiveNumber(values, 'sms_cost_ugx_per_message'), whatsappMarketingUgx: whatsapp.marketing, whatsappUtilityUgx: whatsapp.utility, whatsappBasis: whatsapp.basis };
  return c.json({ success: true, data: { readiness, nightly, holdoutAssignments: counts, settingsSet: Object.keys(values).filter((k) => k !== 'holdout_salt'), costs, ga4Series } });
});

/** Creator payments agreed outside a contract record (0204). Listed with the creators to choose from. */
routes.get('/creator-costs', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const r = registry();
  const [rows, creators] = await Promise.all([r.creatorCostStore.list(Math.min(800, Number(c.req.query('days') ?? 400) || 400)), r.creatorCostStore.creators()]);
  return c.json({ success: true, data: { rows, creators } });
});
routes.post('/creator-costs', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const input = { creatorId: String(body?.creatorId ?? ''), label: String(body?.label ?? ''), amountUgx: Number(body?.amountUgx), startDate: String(body?.startDate ?? ''), endDate: String(body?.endDate ?? body?.startDate ?? ''), note: body?.note ? String(body.note) : null, actorId: actorId(c) ?? '' };
  const r = await registry().creatorCostStore.add(input);
  if (!r.ok) return bad(c, r.message);
  await registry().createAuditLogUseCase.execute({ actorId: input.actorId, action: 'CREATOR_COST_ADDED', entity: 'creator_negotiated_costs', entityId: r.id, newState: { creatorId: input.creatorId, label: input.label, amountUgx: input.amountUgx, startDate: input.startDate, endDate: input.endDate } });
  return c.json({ success: true, data: { id: r.id } });
});
routes.delete('/creator-costs/:id', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  const r = await registry().creatorCostStore.end(id, actorId(c) ?? '');
  if (!r.ok) return bad(c, r.message);
  await registry().createAuditLogUseCase.execute({ actorId: actorId(c) ?? '', action: 'CREATOR_COST_ENDED', entity: 'creator_negotiated_costs', entityId: id, newState: { ended: r.wasLive } });
  return c.json({ success: true, data: { ended: r.wasLive } });
});

/** The shop's copy of GA4's daily series (0205): one report over a window. */
routes.get('/ga4-series', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const report = String(c.req.query('report') ?? 'channel');
  if (!(report in GA4_REPORTS)) return bad(c, `report is one of ${Object.keys(GA4_REPORTS).join(', ')}.`);
  return c.json({ success: true, data: { report, rows: await registry().ga4DailyPull.series(report as Ga4ReportKey, Math.min(400, Number(c.req.query('days') ?? 28) || 28)) } });
});

/** Paid placements on YouTube channels, radio, TV (0206). */
routes.get('/placements', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => c.json({ success: true, data: {
  rows: await registry().mediaPlacementStore.list(Math.min(800, Number(c.req.query('days') ?? 400) || 400)), media: PLACEMENT_MEDIA, mediumLabels: MEDIUM_LABELS, types: PLACEMENT_TYPES,
  viewsConfigured: Boolean((process.env.YOUTUBE_API_KEY ?? '').trim()) } }));
routes.post('/placements', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const b = await c.req.json().catch(() => null);
  const num = (v: unknown): number | null => (v === '' || v == null ? null : Number(v));
  const input = { medium: String(b?.medium ?? ''), outlet: String(b?.outlet ?? ''), outletUrl: b?.outletUrl ? String(b.outletUrl) : null, title: String(b?.title ?? ''), placementType: String(b?.placementType ?? ''),
    videoUrl: b?.videoUrl ? String(b.videoUrl) : null, publishDate: String(b?.publishDate ?? ''), flightDays: num(b?.flightDays), costUgx: Number(b?.costUgx), payee: b?.payee ? String(b.payee) : null,
    promoCode: b?.promoCode ? String(b.promoCode) : null, expectedViews: num(b?.expectedViews), expectedOrders: num(b?.expectedOrders), audienceUgShare: num(b?.audienceUgShare), note: b?.note ? String(b.note) : null, actorId: actorId(c) ?? '' };
  const r = await registry().mediaPlacementStore.add(input);
  if (!r.ok) return bad(c, r.message);
  await registry().createAuditLogUseCase.execute({ actorId: input.actorId, action: 'MEDIA_PLACEMENT_ADDED', entity: 'media_placements', entityId: r.id, newState: { medium: input.medium, outlet: input.outlet, title: input.title, publishDate: input.publishDate, flightDays: input.flightDays, costUgx: input.costUgx } });
  return c.json({ success: true, data: { id: r.id, link: r.link } });
});
routes.delete('/placements/:id', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  const r = await registry().mediaPlacementStore.end(id, actorId(c) ?? '');
  if (!r.ok) return bad(c, r.message);
  await registry().createAuditLogUseCase.execute({ actorId: actorId(c) ?? '', action: 'MEDIA_PLACEMENT_ENDED', entity: 'media_placements', entityId: id, newState: { ended: r.wasLive } });
  return c.json({ success: true, data: { ended: r.wasLive } });
});

routes.get('/readiness', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => c.json({ success: true, data: await registry().mmmDataset.readiness() }));

routes.get('/daily', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const from = c.req.query('from'), to = c.req.query('to');
  if ((from && !DAY.test(from)) || (to && !DAY.test(to))) return bad(c, 'Dates are YYYY-MM-DD.');
  return c.json({ success: true, data: { rows: await registry().mmmDataset.dailyRows(from, to) } });
});

/** daily.csv + controls.csv in one zip, exactly as ops/mmm reads them. */
routes.get('/export', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const from = c.req.query('from'), to = c.req.query('to');
  if ((from && !DAY.test(from)) || (to && !DAY.test(to))) return bad(c, 'Dates are YYYY-MM-DD.');
  const { daily, controls } = await registry().mmmDataset.exportCsv(from, to);
  const zip = storeZip([{ name: 'daily.csv', content: daily }, { name: 'controls.csv', content: controls }]);
  return new Response(new Uint8Array(zip), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="goldplus-mmm-${new Date().toISOString().slice(0, 10)}.zip"` } });
});

routes.get('/controls', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => c.json({ success: true, data: { keys: CONTROL_KEYS, manualKeys: MANUAL_CONTROL_KEYS, help: CONTROL_HELP, rows: await registry().mmmDataset.listControls(Math.min(400, Number(c.req.query('days') ?? 60) || 60)) } }));

routes.post('/controls', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const input = { day: String(body?.day ?? ''), key: String(body?.key ?? ''), value: Number(body?.value), note: body?.note ? String(body.note).slice(0, 200) : null, actorId: actorId(c) ?? '' };
  const r = await registry().mmmDataset.setManualControl(input);
  if (!r.ok) return bad(c, r.message);
  await registry().createAuditLogUseCase.execute({ actorId: input.actorId, action: 'MEASUREMENT_CONTROL_SET', entity: 'measurement_control_series', entityId: `${input.day}:${input.key}`, newState: { value: input.value, note: input.note } });
  return c.json({ success: true, data: { saved: true } });
});

routes.get('/settings', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const values = await registry().measurementConfig.values();
  return c.json({ success: true, data: { entries: MEASUREMENT_CONFIG_REGISTRY.map((e) => ({ ...e, value: values[e.key] ?? null, set: values[e.key] !== undefined })) } });
});
routes.put('/settings/:key', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const r = await registry().measurementConfig.set({ key: String(c.req.param('key') ?? ''), value: String(body?.value ?? ''), actorId: actorId(c) ?? '' });
  return r.ok ? c.json({ success: true, data: { saved: true } }) : bad(c, r.message);
});
routes.delete('/settings/:key', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const r = await registry().measurementConfig.unset({ key: String(c.req.param('key') ?? ''), actorId: actorId(c) ?? '' });
  return r.ok ? c.json({ success: true, data: { unset: true, wasSet: r.wasSet } }) : bad(c, r.message);
});

routes.get('/holdouts', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const r = registry();
  const [waves, counts] = await Promise.all([r.holdoutStore.results(), r.holdoutStore.assignmentCounts()]);
  return c.json({ success: true, data: { programmes: HOLDOUT_PROGRAMMES, counts, waves: waves.map((w) => ({ ...w, lift: { ...w.lift, incrementalRevenueUGX: w.lift.incrementalRevenueMinor.toString(), incrementalRevenueMinor: undefined } })) } });
});

routes.get('/reconciliation', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const r = registry();
  const rec = new Ga4Reconciliation(r.measurementConfig, new HttpGa4Reader(r.ga4DataApi), careDeskAlarm(r.careDeskUseCases));
  return c.json({ success: true, data: await rec.latest() });
});

/** Run the nightly now (costs, dataset, holdout outcomes, GA4 check). Bounded by the same lock as the schedule. */
routes.post('/run', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const r = await runMeasurementNightlyOnce(new Date(), 'admin');
  await registry().createAuditLogUseCase.execute({ actorId: actorId(c) ?? '', action: 'MEASUREMENT_NIGHTLY_RUN', entity: 'measurement_nightly', entityId: new Date().toISOString().slice(0, 10), newState: { status: r.status } });
  return c.json({ success: true, data: r });
});

export default routes;
