import { Hono, type Context } from 'hono';
import { PERMISSIONS } from '@goldplus/shared';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { MEASUREMENT_CONFIG_REGISTRY } from '../../../../domain/measurement/MeasurementConfig';
import { HOLDOUT_PROGRAMMES } from '../../../../domain/measurement/Incrementality';
import { CONTROL_KEYS, MANUAL_CONTROL_KEYS } from '../../../../infrastructure/measurement/MmmDataset';
import { Ga4Reconciliation, HttpGa4Reader, careDeskAlarm } from '../../../../infrastructure/measurement/Ga4Reconciliation';
import { lastMeasurementNightly, runMeasurementNightlyOnce } from '../../../../infrastructure/scheduler/MeasurementNightlyTicker';
import { storeZip } from '../../../../infrastructure/measurement/storeZip';

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
  const [readiness, nightly, counts, values] = await Promise.all([r.mmmDataset.readiness(), lastMeasurementNightly(), r.holdoutStore.assignmentCounts(), r.measurementConfig.values()]);
  return c.json({ success: true, data: { readiness, nightly, holdoutAssignments: counts, settingsSet: Object.keys(values).filter((k) => k !== 'holdout_salt') } });
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

routes.get('/controls', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => c.json({ success: true, data: { keys: CONTROL_KEYS, manualKeys: MANUAL_CONTROL_KEYS, rows: await registry().mmmDataset.listControls(Math.min(400, Number(c.req.query('days') ?? 60) || 60)) } }));

routes.post('/controls', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const r = await registry().mmmDataset.setManualControl({ day: String(body?.day ?? ''), key: String(body?.key ?? ''), value: Number(body?.value), note: body?.note ? String(body.note).slice(0, 200) : null, actorId: actorId(c) ?? '' });
  return r.ok ? c.json({ success: true, data: { saved: true } }) : bad(c, r.message);
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
  const rec = new Ga4Reconciliation(r.measurementConfig, new HttpGa4Reader(r.seoIntegrationRepo), careDeskAlarm(r.careDeskUseCases));
  return c.json({ success: true, data: await rec.latest() });
});

/** Run the nightly now (costs, dataset, holdout outcomes, GA4 check). Bounded by the same lock as the schedule. */
routes.post('/run', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const r = await runMeasurementNightlyOnce(new Date(), 'admin');
  return c.json({ success: true, data: r });
});

export default routes;
