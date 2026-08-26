import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';
import { Registry } from '../../../../infrastructure/Registry';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { BatteryOperationError } from '../../../../application/use-cases/batteries/BatteryOperationError';

/**
 * Staged battery spreadsheet imports: upload, map, dry run, resolve rows,
 * approve (second person), apply, roll back, error report. Same rights as the
 * product importer (pim.*); costs on receipt rows need product_costs.manage.
 *
 * audit-exempt: every step appends an immutable battery_import_events row and
 * the applied records are audited by the battery use cases (CreateAuditLogUseCase).
 */
const routes = new Hono();
routes.use('*', authMiddleware);

type Ctx = Context;
const param = (c: Ctx, name: string): string => c.req.param(name) ?? '';
const ok = <T>(c: Ctx, data: T, status = 200) => c.json({ success: true, data } satisfies ApiResponse<T>, status as 200);
const bad = (c: Ctx, code: string, message: string, status = 400, details?: unknown) =>
  c.json({ success: false, error: { code, message, details } } satisfies ApiResponse<never>, status as 400);
const actor = (c: Ctx): string => (c.get('user') as { id: string }).id;
const has = (c: Ctx, permission: string): boolean => ((c.get('user') as { permissions?: string[] }).permissions ?? []).includes(permission);
const uc = () => Registry.getInstance().batteryImportUseCases;

async function run<T>(c: Ctx, fn: () => Promise<T>, status = 200) {
  try {
    return ok(c, await fn(), status);
  } catch (error) {
    if (error instanceof BatteryOperationError) return bad(c, error.code, error.message, error.status, error.details);
    throw error;
  }
}

async function body<T extends z.ZodTypeAny>(c: Ctx, schema: T): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return { ok: false, response: bad(c, 'INVALID_BODY', parsed.error.issues[0]?.message ?? 'Invalid body.', 400, parsed.error.issues) };
  return { ok: true, data: parsed.data };
}

const version = z.object({ expectedVersion: z.number().int().positive() });

routes.get('/', requirePermissions([PERMISSIONS.PIM_READ]), (c) => run(c, () => uc().list(Number(c.req.query('limit')) || 100)));
routes.get('/fields', requirePermissions([PERMISSIONS.PIM_READ]), (c) => run(c, async () => uc().fields(c.req.query('importType') ?? '')));
routes.get('/templates', requirePermissions([PERMISSIONS.PIM_READ]), (c) => run(c, () => uc().listTemplates(c.req.query('importType') ?? '')));

async function readUpload(c: Ctx) {
  const form = await c.req.parseBody().catch(() => null);
  if (!form) return null;
  const file = form['file'];
  if (!(file instanceof File)) return null;
  return {
    file,
    buffer: Buffer.from(await file.arrayBuffer()),
    importType: typeof form['importType'] === 'string' ? form['importType'] : '',
    name: typeof form['name'] === 'string' ? form['name'] : file.name,
    sheetName: typeof form['sheet'] === 'string' && form['sheet'] ? form['sheet'] : null,
  };
}

routes.post('/sheets', requirePermissions([PERMISSIONS.PIM_CREATE]), async (c) => {
  const upload = await readUpload(c);
  if (!upload) return bad(c, 'BAD_INPUT', 'Attach a .xlsx or .csv file as "file".');
  return run(c, async () => ({ sheets: uc().listSheetNames(upload.buffer, upload.file.name) }));
});

routes.post('/', requirePermissions([PERMISSIONS.PIM_CREATE]), async (c) => {
  const upload = await readUpload(c);
  if (!upload) return bad(c, 'BAD_INPUT', 'Attach a .xlsx or .csv file as "file" with importType and name.');
  return run(c, () => uc().upload({ importType: upload.importType, name: upload.name, filename: upload.file.name, mime: upload.file.type, buffer: upload.buffer, sheetName: upload.sheetName, actorId: actor(c) }), 201);
});

routes.get('/:id', requirePermissions([PERMISSIONS.PIM_READ]), (c) => run(c, () => uc().detail(param(c, 'id'))));

routes.post('/:id/mapping', requirePermissions([PERMISSIONS.PIM_MAP]), async (c) => {
  const b = await body(c, version.extend({ mapping: z.record(z.string(), z.string().max(120)), templateId: z.string().uuid().nullable().optional(), saveAsTemplate: z.string().trim().max(120).nullable().optional() }));
  if (!b.ok) return b.response;
  return run(c, () => uc().saveMapping({ id: param(c, 'id'), expectedVersion: b.data.expectedVersion, mapping: b.data.mapping, templateId: b.data.templateId ?? null, saveAsTemplate: b.data.saveAsTemplate ?? null, actorId: actor(c) }));
});

routes.post('/:id/preview', requirePermissions([PERMISSIONS.PIM_MAP]), async (c) => {
  const b = await body(c, version);
  if (!b.ok) return b.response;
  return run(c, () => uc().preview({ id: param(c, 'id'), expectedVersion: b.data.expectedVersion, actorId: actor(c) }));
});

routes.post('/:id/rows/:rowId/resolve', requirePermissions([PERMISSIONS.PIM_MAP]), async (c) => {
  const b = await body(c, z.object({ resolution: z.enum(['INCLUDE', 'EXCLUDE', 'HOLD']), note: z.string().trim().max(500).nullable().optional(), override: z.record(z.string(), z.unknown()).nullable().optional() }));
  if (!b.ok) return b.response;
  return run(c, () => uc().resolveRow({ id: param(c, 'id'), rowId: param(c, 'rowId'), resolution: b.data.resolution, note: b.data.note ?? null, override: b.data.override ?? null, actorId: actor(c) }));
});

routes.post('/:id/approval', requirePermissions([PERMISSIONS.PIM_APPROVE]), async (c) => {
  const b = await body(c, version.extend({ decision: z.enum(['APPROVED', 'REJECTED']), reason: z.string().trim().min(3).max(2000) }));
  if (!b.ok) return b.response;
  return run(c, () => uc().approve({ id: param(c, 'id'), expectedVersion: b.data.expectedVersion, actorId: actor(c), decision: b.data.decision, reason: b.data.reason }));
});

routes.post('/:id/apply', requirePermissions([PERMISSIONS.PIM_APPLY]), async (c) => {
  const b = await body(c, version);
  if (!b.ok) return b.response;
  return run(c, () => uc().apply({ id: param(c, 'id'), expectedVersion: b.data.expectedVersion, actorId: actor(c), canRecordCost: has(c, PERMISSIONS.PRODUCT_COSTS_MANAGE) }));
});

routes.post('/:id/rollback', requirePermissions([PERMISSIONS.PIM_ROLLBACK]), async (c) => {
  const b = await body(c, version.extend({ reason: z.string().trim().min(3).max(2000) }));
  if (!b.ok) return b.response;
  return run(c, () => uc().rollback({ id: param(c, 'id'), expectedVersion: b.data.expectedVersion, actorId: actor(c), reason: b.data.reason }));
});

routes.get('/:id/error-report', requirePermissions([PERMISSIONS.PIM_READ]), async (c) => {
  try {
    const report = await uc().errorReport(param(c, 'id'));
    c.header('Content-Type', 'text/csv; charset=utf-8');
    c.header('Content-Disposition', `attachment; filename="${report.filename}"`);
    return c.body(report.csv);
  } catch (error) {
    if (error instanceof BatteryOperationError) return bad(c, error.code, error.message, error.status);
    throw error;
  }
});

export default routes;
