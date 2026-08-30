import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';

/**
 * Blog administration (0126). Reading is SEO_VIEW; writing and publishing are
 * SEO_METADATA_MANAGE — an article is search-facing content, and it is governed
 * by whoever governs what the shop says to search engines.
 *
 * Every write is audited: published words are a public statement by the
 * business, so who changed them has to be answerable later.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

const actorOf = (c: { get: (k: string) => unknown }) => (c.get('user') as { id: string; name?: string } | undefined);

const bad = (c: any, code: string, message: string, status = 400) => {
  const res: ApiResponse<never> = { success: false, error: { code, message } };
  return c.json(res, status);
};

async function audit(actorId: string, action: string, entityId: string, newState: unknown): Promise<void> {
  await Registry.getInstance().createAuditLogUseCase.execute({
    actorId,
    action,
    entity: 'blog_post',
    entityId,
    previousState: null,
    newState,
  });
}

routes.get('/', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const limit = Number.parseInt(c.req.query('limit') ?? '50', 10);
  const offset = Number.parseInt(c.req.query('offset') ?? '0', 10);
  const posts = await Registry.getInstance().blogRepo.listAll({
    limit: Number.isFinite(limit) ? limit : 50,
    offset: Number.isFinite(offset) ? offset : 0,
  });
  return c.json({ success: true, data: posts } satisfies ApiResponse<typeof posts>);
});

routes.get('/:id', requirePermissions([PERMISSIONS.SEO_VIEW]), async (c) => {
  const found = await Registry.getInstance().getPostForAdminUseCase.execute(c.req.param('id') ?? '');
  if (!found) return bad(c, 'NOT_FOUND', 'That article no longer exists.', 404);
  return c.json({ success: true, data: found } satisfies ApiResponse<typeof found>);
});

routes.post('/', requirePermissions([PERMISSIONS.SEO_METADATA_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.title !== 'string') return bad(c, 'INVALID_JSON', 'A title is required.');
  const actor = actorOf(c);
  const result = await Registry.getInstance().createPostUseCase.execute({
    title: body.title,
    slug: typeof body.slug === 'string' ? body.slug : undefined,
    excerpt: typeof body.excerpt === 'string' ? body.excerpt : '',
    body: typeof body.body === 'string' ? body.body : '',
    coverImageUrl: body.coverImageUrl ?? null,
    coverImageAlt: body.coverImageAlt ?? null,
    metaTitle: body.metaTitle ?? null,
    metaDescription: body.metaDescription ?? null,
    relatedProductIds: Array.isArray(body.relatedProductIds) ? body.relatedProductIds : [],
    authorId: actor?.id ?? null,
    authorName: typeof body.authorName === 'string' ? body.authorName : undefined,
  });
  if (!result.ok) return bad(c, result.code, result.message);
  await audit(actor?.id ?? 'unknown', 'BLOG_POST_CREATED', result.value.id, { slug: result.value.slug, title: result.value.title });
  return c.json({ success: true, data: result.value } satisfies ApiResponse<typeof result.value>, 201);
});

routes.put('/:id', requirePermissions([PERMISSIONS.SEO_METADATA_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.title !== 'string') return bad(c, 'INVALID_JSON', 'A title is required.');
  const id = c.req.param('id') ?? '';
  const result = await Registry.getInstance().updatePostUseCase.execute(id, {
    title: body.title,
    slug: typeof body.slug === 'string' ? body.slug : undefined,
    excerpt: typeof body.excerpt === 'string' ? body.excerpt : '',
    body: typeof body.body === 'string' ? body.body : '',
    coverImageUrl: body.coverImageUrl ?? null,
    coverImageAlt: body.coverImageAlt ?? null,
    metaTitle: body.metaTitle ?? null,
    metaDescription: body.metaDescription ?? null,
    relatedProductIds: Array.isArray(body.relatedProductIds) ? body.relatedProductIds : [],
  });
  if (!result.ok) return bad(c, result.code, result.message, result.code === 'NOT_FOUND' ? 404 : 400);
  await audit(actorOf(c)?.id ?? 'unknown', 'BLOG_POST_UPDATED', id, { slug: result.value.slug, title: result.value.title });
  return c.json({ success: true, data: result.value } satisfies ApiResponse<typeof result.value>);
});

routes.post('/:id/publish', requirePermissions([PERMISSIONS.SEO_METADATA_MANAGE]), async (c) => {
  const id = c.req.param('id') ?? '';
  const result = await Registry.getInstance().publishPostUseCase.execute(id);
  if (!result.ok) return bad(c, result.code, result.message, result.code === 'NOT_FOUND' ? 404 : 400);
  await audit(actorOf(c)?.id ?? 'unknown', 'BLOG_POST_PUBLISHED', id, { slug: result.value.slug, publishedAt: result.value.publishedAt });
  return c.json({ success: true, data: result.value } satisfies ApiResponse<typeof result.value>);
});

routes.post('/:id/unpublish', requirePermissions([PERMISSIONS.SEO_METADATA_MANAGE]), async (c) => {
  const id = c.req.param('id') ?? '';
  const body = await c.req.json().catch(() => ({}));
  const status = body?.status === 'ARCHIVED' ? 'ARCHIVED' : 'DRAFT';
  const result = await Registry.getInstance().unpublishPostUseCase.execute(id, status);
  if (!result.ok) return bad(c, result.code, result.message, result.code === 'NOT_FOUND' ? 404 : 400);
  await audit(actorOf(c)?.id ?? 'unknown', 'BLOG_POST_UNPUBLISHED', id, { slug: result.value.slug, status });
  return c.json({ success: true, data: result.value } satisfies ApiResponse<typeof result.value>);
});

routes.delete('/:id', requirePermissions([PERMISSIONS.SEO_METADATA_MANAGE]), async (c) => {
  const id = c.req.param('id') ?? '';
  const result = await Registry.getInstance().deletePostUseCase.execute(id);
  if (!result.ok) return bad(c, result.code, result.message, 404);
  await audit(actorOf(c)?.id ?? 'unknown', 'BLOG_POST_DELETED', id, { id });
  return c.json({ success: true, data: result.value } satisfies ApiResponse<typeof result.value>);
});

export default routes;
