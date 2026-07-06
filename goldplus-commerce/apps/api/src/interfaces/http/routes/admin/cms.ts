import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { CreateAuditLogUseCase } from '../../../../application/use-cases/audit/CreateAuditLogUseCase';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';

const routes = new Hono();
const registry = Registry.getInstance();

routes.use('*', authMiddleware);

function actorId(c: any): string {
  return (c.get('user') as any).id;
}

async function readJson(c: any): Promise<any | null> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

routes.get('/', requirePermissions([PERMISSIONS.CONTENT_MANAGE]), async (c) => {
  const pages = await registry.listCmsPagesUseCase.execute();
  const data = pages.map((p) => ({
    id: p.id,
    slug: p.slug,
    title: p.title,
    status: p.status,
    currentVersion: p.currentVersion,
    publishAt: p.publishAt?.toISOString() ?? null,
    expireAt: p.expireAt?.toISOString() ?? null,
    updatedAt: p.updatedAt.toISOString(),
  }));
  const res: ApiResponse<typeof data> = { success: true, data };
  return c.json(res);
});

routes.post('/', requirePermissions([PERMISSIONS.CONTENT_MANAGE]), async (c) => {
  const body = await readJson(c);
  if (!body) {
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_JSON', message: 'Request body must be JSON.' } };
    return c.json(res, 400);
  }

  const result = await registry.createCmsPageUseCase.execute({
    slug: String(body.slug ?? ''),
    title: String(body.title ?? ''),
    body: String(body.body ?? ''),
    excerpt: body.excerpt ? String(body.excerpt) : null,
    metaTitle: body.metaTitle ? String(body.metaTitle) : null,
    metaDescription: body.metaDescription ? String(body.metaDescription) : null,
    editedBy: actorId(c),
  });

  if (!result.ok) {
    const status = result.code === 'DUPLICATE_SLUG' ? 409 : 400;
    const res: ApiResponse<never> = { success: false, error: { code: result.code, message: result.message } };
    return c.json(res, status);
  }

  const auditUc = new CreateAuditLogUseCase(registry.auditRepo);
  await auditUc.execute({
    actorId: actorId(c),
    action: 'CMS_PAGE_CREATED',
    entity: 'cms_page',
    entityId: result.page.id,
    newState: { slug: result.page.slug, title: result.page.title },
  });

  const res: ApiResponse<{ id: string; slug: string; status: string }> = {
    success: true,
    data: { id: result.page.id, slug: result.page.slug, status: result.page.status },
  };
  return c.json(res, 201);
});

routes.put('/:id', requirePermissions([PERMISSIONS.CONTENT_MANAGE]), async (c) => {
  const body = await readJson(c);
  if (!body) {
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_JSON', message: 'Request body must be JSON.' } };
    return c.json(res, 400);
  }

  const result = await registry.updateCmsPageUseCase.execute({
    pageId: String(c.req.param('id')),
    title: String(body.title ?? ''),
    body: String(body.body ?? ''),
    excerpt: body.excerpt ? String(body.excerpt) : null,
    metaTitle: body.metaTitle ? String(body.metaTitle) : null,
    metaDescription: body.metaDescription ? String(body.metaDescription) : null,
    editedBy: actorId(c),
  });

  if (!result.ok) {
    const status = result.code === 'NOT_FOUND' ? 404 : 400;
    const res: ApiResponse<never> = { success: false, error: { code: result.code, message: result.message } };
    return c.json(res, status);
  }

  const auditUc = new CreateAuditLogUseCase(registry.auditRepo);
  await auditUc.execute({
    actorId: actorId(c),
    action: 'CMS_PAGE_UPDATED',
    entity: 'cms_page',
    entityId: result.page.id,
    newState: { version: result.page.currentVersion },
  });

  const res: ApiResponse<{ id: string; currentVersion: number }> = {
    success: true,
    data: { id: result.page.id, currentVersion: result.page.currentVersion },
  };
  return c.json(res);
});

routes.patch('/:id/status', requirePermissions([PERMISSIONS.CONTENT_MANAGE]), async (c) => {
  const body = await readJson(c);
  if (!body) {
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_JSON', message: 'Request body must be JSON.' } };
    return c.json(res, 400);
  }

  const result = await registry.changeCmsPageStatusUseCase.execute({
    pageId: String(c.req.param('id')),
    status: String(body.status ?? ''),
    publishAt: body.publishAt ? String(body.publishAt) : null,
    expireAt: body.expireAt ? String(body.expireAt) : null,
    editedBy: actorId(c),
  });

  if (!result.ok) {
    const status = result.code === 'NOT_FOUND' ? 404 : 400;
    const res: ApiResponse<never> = { success: false, error: { code: result.code, message: result.message } };
    return c.json(res, status);
  }

  const auditUc = new CreateAuditLogUseCase(registry.auditRepo);
  await auditUc.execute({
    actorId: actorId(c),
    action: 'CMS_PAGE_STATUS_CHANGED',
    entity: 'cms_page',
    entityId: result.page.id,
    newState: {
      status: result.page.status,
      publishAt: result.page.publishAt?.toISOString() ?? null,
      expireAt: result.page.expireAt?.toISOString() ?? null,
    },
  });

  const res: ApiResponse<{ id: string; status: string }> = {
    success: true,
    data: { id: result.page.id, status: result.page.status },
  };
  return c.json(res);
});

routes.get('/:id/revisions', requirePermissions([PERMISSIONS.CONTENT_MANAGE]), async (c) => {
  const revisions = await registry.listCmsPageRevisionsUseCase.execute(String(c.req.param('id')));
  const data = revisions.map((r) => ({
    version: r.version,
    title: r.title,
    editedBy: r.editedBy,
    createdAt: r.createdAt.toISOString(),
  }));
  const res: ApiResponse<typeof data> = { success: true, data };
  return c.json(res);
});

routes.post('/:id/revert/:version', requirePermissions([PERMISSIONS.CONTENT_MANAGE]), async (c) => {
  const version = parseInt(String(c.req.param('version')), 10);
  if (Number.isNaN(version)) {
    const res: ApiResponse<never> = { success: false, error: { code: 'BAD_VERSION', message: 'Version must be a number.' } };
    return c.json(res, 400);
  }

  const result = await registry.revertCmsPageUseCase.execute({
    pageId: String(c.req.param('id')),
    version,
    editedBy: actorId(c),
  });

  if (!result.ok) {
    const status = result.code === 'NOT_FOUND' || result.code === 'REVISION_NOT_FOUND' ? 404 : 400;
    const res: ApiResponse<never> = { success: false, error: { code: result.code, message: result.message } };
    return c.json(res, status);
  }

  const auditUc = new CreateAuditLogUseCase(registry.auditRepo);
  await auditUc.execute({
    actorId: actorId(c),
    action: 'CMS_PAGE_REVERTED',
    entity: 'cms_page',
    entityId: result.page.id,
    newState: { revertedToVersion: version, newVersion: result.page.currentVersion },
  });

  const res: ApiResponse<{ id: string; currentVersion: number }> = {
    success: true,
    data: { id: result.page.id, currentVersion: result.page.currentVersion },
  };
  return c.json(res);
});

export default routes;
