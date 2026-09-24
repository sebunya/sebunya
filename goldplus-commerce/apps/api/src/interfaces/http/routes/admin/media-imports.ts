import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { adminUploadLimit } from '../../middleware/uploadLimit';
import { Registry } from '../../../../infrastructure/Registry';
import { CreateAuditLogUseCase } from '../../../../application/use-cases/audit/CreateAuditLogUseCase';
import { PERMISSIONS } from '@goldplus/shared';
import { csvCell } from '../../csv';
import { IMAGE_EXTENSIONS } from '../../../../domain/media/PhotoCodeMatcher';

/**
 * Focus 4 — reviewed bulk image import.
 *   POST   /            stage files (+ manifest) → plan (a WRITE: assets + a session)
 *   GET    /            sessions      GET /:id  plan + rows      GET /:id/results.csv
 *   POST   /:id/approval   { expectedVersion, decision, reason }   four eyes
 *   POST   /:id/apply      { expectedVersion, resume? }            per-product ledger
 * Same scope as the media library (MEDIA_MANAGE); the second person is enforced
 * by actor identity, not by a new permission system.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

const actor = (c: any) => (c.get('user') as any).id as string;
const audit = (c: any, action: string, entityId: string, newState: Record<string, unknown>) =>
  new CreateAuditLogUseCase(Registry.getInstance().auditRepo).execute({ actorId: actor(c), action, entity: 'media_import', entityId, newState });

routes.get('/', requirePermissions([PERMISSIONS.MEDIA_READ]), async (c) => {
  const sessions = await Registry.getInstance().mediaImportUseCases.list(50);
  return c.json({ success: true, data: { sessions } });
});

routes.post('/', requirePermissions([PERMISSIONS.MEDIA_MANAGE]), adminUploadLimit, async (c) => {
  const body = await c.req.parseBody({ all: true });
  const raw = body['files'];
  const files = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'Choose at least one image file.' } }, 400);
  const notImages = files.filter((f) => !IMAGE_EXTENSIONS.has(('.' + f.name.split('.').pop()).toLowerCase()));
  if (notImages.length) return c.json({ success: false, error: { code: 'BAD_INPUT', message: `Not an image: ${notImages.map((f) => f.name).join(', ')}` } }, 400);
  const manifestFile = body['manifest'] instanceof File && (body['manifest'] as File).size > 0 ? (body['manifest'] as File) : null;
  const manifest = manifestFile ? { filename: manifestFile.name, text: await manifestFile.text() } : null;
  const uc = Registry.getInstance().mediaImportUseCases;
  const result = await uc.stage({
    name: typeof body['name'] === 'string' ? body['name'] : '',
    files: await Promise.all(files.map(async (f) => ({ filename: f.name, mime: f.type, buffer: Buffer.from(await f.arrayBuffer()) }))),
    manifest,
    actorId: actor(c),
  });
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } }, 400);
  await audit(c, 'MEDIA_IMPORT_STAGED', result.session.id, { files: files.length, totals: result.plan.totals, blocking: result.plan.blocking, planHash: result.plan.planHash, manifestErrors: result.manifestErrors });
  return c.json({ success: true, data: { session: result.session, totals: result.plan.totals, blocking: result.plan.blocking, manifestErrors: result.manifestErrors } }, 201);
});

routes.get('/:id', requirePermissions([PERMISSIONS.MEDIA_READ]), async (c) => {
  const detail = await Registry.getInstance().mediaImportUseCases.detail(c.req.param('id') ?? '');
  if (!detail) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Import session not found.' } }, 404);
  return c.json({ success: true, data: detail });
});

routes.get('/:id/results.csv', requirePermissions([PERMISSIONS.MEDIA_READ]), async (c) => {
  const rows = await Registry.getInstance().mediaImportUseCases.results(c.req.param('id') ?? '');
  if (!rows) return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Import session not found.' } }, 404);
  const columns = ['row', 'filename', 'sha256', 'sku', 'product_id', 'slot', 'role', 'plan_status', 'blocking', 'issues', 'expected_revision', 'apply_status', 'applied_revision', 'error'];
  const csv = [columns.join(','), ...rows.map((r) => columns.map((k) => csvCell(r[k] ?? null)).join(','))].join('\r\n');
  return c.body(csv, 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="media-import-${c.req.param('id')}.csv"` });
});

routes.post('/:id/approval', requirePermissions([PERMISSIONS.MEDIA_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const decision = body?.decision === 'REJECTED' ? 'REJECTED' : body?.decision === 'APPROVED' ? 'APPROVED' : null;
  const expectedVersion = Number(body?.expectedVersion);
  if (!decision || !Number.isInteger(expectedVersion)) return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'decision (APPROVED|REJECTED) and expectedVersion are required.' } }, 400);
  const result = await Registry.getInstance().mediaImportUseCases.approve({ id: c.req.param('id') ?? '', expectedVersion, actorId: actor(c), decision, reason: String(body?.reason ?? '') });
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } }, result.code === 'NOT_FOUND' ? 404 : result.code === 'FOUR_EYES_REQUIRED' ? 403 : 409);
  await audit(c, decision === 'APPROVED' ? 'MEDIA_IMPORT_APPROVED' : 'MEDIA_IMPORT_REJECTED', result.session.id, { version: result.session.version, reason: String(body?.reason ?? '') });
  return c.json({ success: true, data: result.session });
});

routes.post('/:id/apply', requirePermissions([PERMISSIONS.MEDIA_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const expectedVersion = Number(body?.expectedVersion);
  if (!Number.isInteger(expectedVersion)) return c.json({ success: false, error: { code: 'BAD_INPUT', message: 'expectedVersion is required.' } }, 400);
  const result = await Registry.getInstance().mediaImportUseCases.apply({ id: c.req.param('id') ?? '', expectedVersion, actorId: actor(c), resume: Boolean(body?.resume) });
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } }, result.code === 'NOT_FOUND' ? 404 : 409);
  await audit(c, body?.resume ? 'MEDIA_IMPORT_RESUMED' : 'MEDIA_IMPORT_APPLIED', result.session.id, { ...result.summary, status: result.session.status });
  return c.json({ success: true, data: { session: result.session, summary: result.summary } });
});

export default routes;
