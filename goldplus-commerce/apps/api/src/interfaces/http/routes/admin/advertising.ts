import { Hono, type Context } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { PERMISSIONS } from '@goldplus/shared';

/**
 * Advertising destinations (0138), mounted at /admin/advertising. Thin: the use
 * case validates ids, encrypts the token (write-only), enforces "complete
 * before live" and audits every change inside the use case
 * (createAuditLogUseCase, action AD_DESTINATION_CONFIGURED). Responses never
 * contain a token.
 */
const routes = new Hono();
routes.use('*', authMiddleware);
const svc = () => Registry.getInstance().advertising;
const STATUS: Record<string, number> = { NOT_FOUND: 404, BAD_INPUT: 400, NOT_CONFIGURED: 409 };

const view = async () => (await svc().list()).map((p) => ({
  key: p.key, name: p.name, state: p.state, unavailable: p.unavailable ?? null, secretLabel: p.secretLabel, secretHint: p.secretHint ?? null,
  fields: p.fields.map((f) => ({ key: f.key, label: f.label, hint: f.hint, optional: !!f.optional, value: p.row?.config?.[f.key] ?? '' })),
  events: p.events, enabled: p.row?.enabled ?? false, secretMask: p.row?.secretMask ?? null,
  testable: !!p.testable, mode: p.row?.mode ?? 'live', eventSelection: p.row?.eventSelection ?? null,
  lastSuccessAt: p.row?.lastSuccessAt ?? null, lastError: p.row?.lastError ?? null, lastErrorAt: p.row?.lastErrorAt ?? null,
  sentCount: p.row?.sentCount ?? 0, failedCount: p.row?.failedCount ?? 0,
}));

routes.get('/', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => c.json({ success: true, data: await view() }));
routes.put('/:platform', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c: Context) => {
  const b = (await c.req.json().catch(() => null)) as { config?: Record<string, unknown>; secret?: string; enabled?: boolean; removeSecret?: boolean; mode?: 'live' | 'test'; eventSelection?: unknown } | null;
  const actorId = (c.get('user') as { id?: string } | undefined)?.id ?? null;
  const r = await svc().configure(actorId, c.req.param('platform') ?? '', {
    config: b?.config, secret: b?.secret, enabled: typeof b?.enabled === 'boolean' ? b.enabled : undefined, removeSecret: b?.removeSecret === true,
    mode: b?.mode === 'live' || b?.mode === 'test' ? b.mode : undefined, eventSelection: b?.eventSelection,
  });
  if (!r.ok) return c.json({ success: false, error: { code: r.code, message: r.message } }, (STATUS[r.code] ?? 400) as never);
  return c.json({ success: true, data: (await view()).find((p) => p.key === c.req.param('platform')) });
});

// ── Advertising operations (0154). Thin: every rule lives in the use cases. ──

const ops = () => Registry.getInstance().advertisingOps;
const actor = (c: Context) => (c.get('user') as { id?: string } | undefined)?.id ?? null;
/** Capability views without the RegExp patterns (and never a secret). */
const capView = async () => (await ops().capabilities.list()).map((v) => ({
  platform: v.platform, capability: v.capability, name: v.name, what: v.what, state: v.state, gap: v.gap || null,
  secretLabel: v.secretLabel, secretWhere: v.secretWhere ?? null, secretOptional: !!v.secretOptional, requiresDestination: v.requiresDestination,
  fields: v.fields.map((f) => ({ key: f.key, label: f.label, where: f.where, optional: !!f.optional, confirm: !!f.confirm, value: v.row?.config?.[f.key] ?? '' })),
  enabled: v.row?.enabled ?? false, secretMask: v.row?.secretMask ?? null, lastRunAt: v.row?.lastRunAt ?? null, lastStatus: v.row?.lastStatus ?? null,
}));

routes.get('/checklist', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => c.json({ success: true, data: await ops().checklist() }));
routes.get('/capabilities', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => c.json({ success: true, data: await capView() }));
routes.put('/capabilities/:platform/:capability', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c: Context) => {
  const b = (await c.req.json().catch(() => null)) as { config?: Record<string, unknown>; secret?: string; enabled?: boolean; removeSecret?: boolean } | null;
  const r = await ops().capabilities.configure(actor(c), c.req.param('platform') ?? '', c.req.param('capability') ?? '', {
    config: b?.config, secret: b?.secret, enabled: typeof b?.enabled === 'boolean' ? b.enabled : undefined, removeSecret: b?.removeSecret === true,
  });
  if (!r.ok) return c.json({ success: false, error: { code: r.code, message: r.message } }, (STATUS[r.code] ?? 400) as never);
  return c.json({ success: true, data: (await capView()).find((v) => v.platform === c.req.param('platform') && v.capability === c.req.param('capability')) });
});

routes.get('/audiences', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const [preview, runs, capabilities, customSegments] = await Promise.all([ops().audiences.preview(), ops().audiences.recentRuns(30), capView(), ops().audiences.availableCustomSegments().catch(() => [])]);
  return c.json({ success: true, data: { preview, runs, capabilities: capabilities.filter((v) => v.capability === 'audiences'), customSegments } });
});
routes.post('/audiences/:platform/run', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c: Context) => {
  const b = (await c.req.json().catch(() => null)) as { mode?: string } | null;
  // The use case logs, audits and records the capability's last run.
  const runs = await ops().audiences.run(c.req.param('platform') ?? '', b?.mode === 'SYNC' ? 'SYNC' : 'DRY_RUN', 'ADMIN', actor(c));
  return c.json({ success: true, data: runs });
});

routes.get('/spend', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const [report, imports, capabilities] = await Promise.all([ops().spend.report(c.req.query('from'), c.req.query('to')), ops().spend.recentImports(20), capView()]);
  return c.json({ success: true, data: { report, imports, capabilities: capabilities.filter((v) => v.capability === 'spend') } });
});
routes.post('/spend/import/:platform', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c: Context) => {
  const b = (await c.req.json().catch(() => null)) as { from?: string; to?: string } | null;
  const r = await ops().spend.importFromApi(c.req.param('platform') ?? '', 'ADMIN', actor(c), { from: b?.from, to: b?.to });
  await ops().capabilities.recordRun(c.req.param('platform') ?? '', 'spend', r.status, r.status === 'FAILED' || r.status === 'REFUSED' ? r.message : null).catch(() => undefined);
  return c.json({ success: true, data: r });
});
routes.post('/spend/csv', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c: Context) => {
  const b = (await c.req.json().catch(() => null)) as { csv?: string; dryRun?: boolean } | null;
  const r = await ops().spend.importCsv(actor(c), String(b?.csv ?? ''), b?.dryRun !== false);
  return c.json({ success: r.ok, data: r }, r.ok ? 200 : 422);
});

routes.get('/offline', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const [overview, capabilities] = await Promise.all([ops().offline.overview(), capView()]);
  return c.json({ success: true, data: { ...overview, capabilities: capabilities.filter((v) => v.capability === 'offline') } });
});
routes.post('/offline/sales', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c: Context) => {
  const b = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  const r = await ops().offline.recordSale(actor(c), {
    channel: String(b?.channel ?? ''), occurredAt: String(b?.occurredAt ?? ''), valueUgx: b?.valueUgx,
    orderNumber: typeof b?.orderNumber === 'string' ? b.orderNumber : null, email: typeof b?.email === 'string' ? b.email : null,
    phone: typeof b?.phone === 'string' ? b.phone : null, note: typeof b?.note === 'string' ? b.note : null,
  });
  if (!r.ok) return c.json({ success: false, error: { code: r.code, message: r.message } }, (STATUS[r.code] ?? 400) as never);
  return c.json({ success: true, data: r.value }, 201);
});

export default routes;
