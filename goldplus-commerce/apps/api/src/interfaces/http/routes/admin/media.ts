import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { CreateAuditLogUseCase } from '../../../../application/use-cases/audit/CreateAuditLogUseCase';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';

/**
 * Media library admin surface (Wave 2B DAM). Thin transport over
 * MediaLibraryUseCase; every mutation is permission-guarded and audited. Uploads are
 * multipart, checksum-deduplicated, refused per-file with a named reason rather than
 * failing the batch.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

const ok = <T>(c: any, data: T) => c.json({ success: true, data } satisfies ApiResponse<T>);
const bad = (c: any, code: string, message: string, status = 400) =>
  c.json({ success: false, error: { code, message } } satisfies ApiResponse<never>, status);

const actor = (c: any): string => (c.get('user') as { id: string }).id;
const audit = (c: any, action: string, entityId: string, newState: unknown) =>
  new CreateAuditLogUseCase(Registry.getInstance().auditRepo).execute({
    actorId: actor(c),
    action,
    entity: 'media_asset',
    entityId,
    newState,
  });

routes.get('/', requirePermissions([PERMISSIONS.MEDIA_READ]), async (c) => {
  const q = c.req.query();
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 24));
  const status = q.status === 'ARCHIVED' ? 'ARCHIVED' : q.status === 'ACTIVE' ? 'ACTIVE' : undefined;
  const result = await Registry.getInstance().mediaLibraryRepo.list({
    query: q.query || undefined,
    status,
    mime: q.mime || undefined,
    page,
    limit,
  });
  return ok(c, { items: result.items, total: result.total, page, limit });
});

routes.get('/missing-product-images', requirePermissions([PERMISSIONS.MEDIA_READ]), async (c) => {
  const products = await Registry.getInstance().mediaLibraryRepo.productsMissingImages();
  return ok(c, { products, total: products.length });
});

routes.get('/:id/usages', requirePermissions([PERMISSIONS.MEDIA_READ]), async (c) => {
  const usages = await Registry.getInstance().mediaLibraryRepo.usages((c.req.param('id') ?? ''));
  return ok(c, { usages });
});

routes.post('/upload', requirePermissions([PERMISSIONS.MEDIA_MANAGE]), async (c) => {
  const body = await c.req.parseBody({ all: true }).catch(() => null);
  if (!body) return bad(c, 'BAD_INPUT', 'Expected multipart form data.');
  const raw = body['files'];
  const fileList = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((f): f is File => f instanceof File);
  if (fileList.length === 0) return bad(c, 'BAD_INPUT', 'At least one image file is required.');
  if (fileList.length > 20) return bad(c, 'BAD_INPUT', 'At most 20 files per upload.');

  const files = await Promise.all(
    fileList.map(async (f) => ({ filename: f.name, mime: f.type, buffer: Buffer.from(await f.arrayBuffer()) })),
  );
  const altText = typeof body['altText'] === 'string' ? (body['altText'] as string) : null;
  const caption = typeof body['caption'] === 'string' ? (body['caption'] as string) : null;

  const outcomes = await Registry.getInstance().mediaLibraryUseCase.upload({
    files,
    altText,
    caption,
    actorId: actor(c),
  });

  const uploaded = outcomes
    .filter((o): o is Extract<typeof o, { kind: 'STORED' }> => o.kind === 'STORED')
    .map((o) => ({ id: o.asset.id, url: o.asset.url, deduplicated: o.deduplicated }));
  const rejected = outcomes
    .filter((o): o is Extract<typeof o, { kind: 'REJECTED' }> => o.kind === 'REJECTED')
    .map((o) => ({ filename: o.filename, reason: o.reason }));
  for (const u of uploaded) await audit(c, 'MEDIA_ASSET_UPLOADED', u.id, { url: u.url, deduplicated: u.deduplicated });
  return ok(c, { uploaded, rejected });
});

routes.post('/:id/metadata', requirePermissions([PERMISSIONS.MEDIA_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return bad(c, 'BAD_INPUT', 'Expected a JSON body.');
  const patch: Record<string, unknown> = {};
  for (const key of ['altText', 'caption', 'rights'] as const) {
    if (typeof body[key] === 'string') patch[key] = body[key].slice(0, 500) || null;
  }
  if (body.rightsExpiresAt) {
    const d = new Date(body.rightsExpiresAt);
    if (!Number.isNaN(d.getTime())) patch.rightsExpiresAt = d;
  }
  for (const key of ['focalX', 'focalY'] as const) {
    const n = Number(body[key]);
    if (Number.isFinite(n) && n >= 0 && n <= 1) patch[key] = n;
  }
  const updated = await Registry.getInstance().mediaLibraryUseCase.updateMetadata((c.req.param('id') ?? ''), patch);
  if (!updated) return bad(c, 'NOT_FOUND', 'Asset not found.', 404);
  await audit(c, 'MEDIA_ASSET_METADATA_UPDATED', updated.id, patch);
  return ok(c, updated);
});

routes.post('/:id/archive', requirePermissions([PERMISSIONS.MEDIA_MANAGE]), async (c) => {
  const updated = await Registry.getInstance().mediaLibraryUseCase.archive((c.req.param('id') ?? ''));
  if (!updated) return bad(c, 'NOT_FOUND', 'Asset not found.', 404);
  await audit(c, 'MEDIA_ASSET_ARCHIVED', updated.id, { status: 'ARCHIVED' });
  return ok(c, updated);
});

routes.post('/:id/restore', requirePermissions([PERMISSIONS.MEDIA_MANAGE]), async (c) => {
  const updated = await Registry.getInstance().mediaLibraryUseCase.restore((c.req.param('id') ?? ''));
  if (!updated) return bad(c, 'NOT_FOUND', 'Asset not found.', 404);
  await audit(c, 'MEDIA_ASSET_RESTORED', updated.id, { status: 'ACTIVE' });
  return ok(c, updated);
});

routes.post('/:id/delete', requirePermissions([PERMISSIONS.MEDIA_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!reason) return bad(c, 'BAD_INPUT', 'A deletion reason is required.');
  const id = (c.req.param('id') ?? '');
  const outcome = await Registry.getInstance().mediaLibraryUseCase.safeDelete(id);
  if (outcome.kind === 'NOT_FOUND') return bad(c, 'NOT_FOUND', 'Asset not found.', 404);
  if (outcome.kind === 'IN_USE') {
    return bad(c, 'ASSET_IN_USE', `Refused: ${outcome.usages} usage(s) still reference this asset.`, 409);
  }
  await audit(c, 'MEDIA_ASSET_DELETED', id, { reason });
  return ok(c, { deleted: true });
});

routes.post('/:id/assign-product', requirePermissions([PERMISSIONS.MEDIA_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const productId = typeof body?.productId === 'string' ? body.productId.trim() : '';
  if (!productId) return bad(c, 'BAD_INPUT', 'productId is required.');
  const outcome = await Registry.getInstance().mediaLibraryUseCase.assignToProduct((c.req.param('id') ?? ''), productId);
  if ('kind' in outcome) return bad(c, 'NOT_FOUND', 'Asset or product not found.', 404);
  await audit(c, 'MEDIA_ASSET_ASSIGNED_PRODUCT', (c.req.param('id') ?? ''), outcome);
  return ok(c, outcome);
});

export default routes;
