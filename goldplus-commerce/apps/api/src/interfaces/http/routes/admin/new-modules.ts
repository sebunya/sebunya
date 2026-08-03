import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { CreateAuditLogUseCase } from '../../../../application/use-cases/audit/CreateAuditLogUseCase';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';

/**
 * Admin read/action surface for the P0-U6 modules (pricing coupons, device
 * catalogue, review moderation, creator platform, flash sales, SEO). Thin: every
 * handler delegates through the Registry to the proven canonical services, and is
 * permission-guarded. Mutations are audited.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

const ok = <T>(c: any, data: T) => c.json({ success: true, data } satisfies ApiResponse<T>);
const bad = (c: any, code: string, message: string, status = 400) => c.json({ success: false, error: { code, message } } satisfies ApiResponse<never>, status);

// ---- U1: coupons -------------------------------------------------------
routes.get('/coupons', requirePermissions([PERMISSIONS.PROMOTIONS_READ]), async (c) => {
  return ok(c, await Registry.getInstance().couponRepo.adminOverview());
});
routes.post('/coupons/batch', requirePermissions([PERMISSIONS.PROMOTIONS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.promotionDefinitionId || !Number.isInteger(body?.count)) return bad(c, 'BAD_INPUT', 'promotionDefinitionId and integer count are required.');
  const registry = Registry.getInstance();
  const result = await registry.couponRepo.generateBatch({ promotionDefinitionId: body.promotionDefinitionId, count: body.count, codeType: body.codeType, maxRedemptions: body.maxRedemptions ?? null, prefix: body.prefix, length: body.length });
  await new CreateAuditLogUseCase(registry.auditRepo).execute({ actorId: (c.get('user') as any).id, action: 'COUPON_BATCH_GENERATED', entity: 'coupon_batch', entityId: result.batchId, newState: { requested: result.requested, inserted: result.inserted } });
  return ok(c, { batchId: result.batchId, requested: result.requested, inserted: result.inserted });
});

// ---- U2: devices -------------------------------------------------------
routes.get('/devices', requirePermissions([PERMISSIONS.PRODUCTS_READ]), async (c) => {
  return ok(c, await Registry.getInstance().deviceRepo.adminList());
});

// ---- U3: reviews (moderation queue) ------------------------------------
routes.get('/reviews', requirePermissions([PERMISSIONS.REVIEWS_MODERATE]), async (c) => {
  const status = (c.req.query('status') as any) || 'pending';
  const registry = Registry.getInstance();
  const [items, counts] = await Promise.all([registry.reviewRepo.listByStatus(status), registry.reviewRepo.countByStatus()]);
  return ok(c, { items, counts });
});
routes.post('/reviews/:id/moderate', requirePermissions([PERMISSIONS.REVIEWS_MODERATE]), async (c) => {
  const id = String(c.req.param('id'));
  const body = await c.req.json().catch(() => null);
  const status = body?.status;
  if (!['published', 'rejected', 'flagged'].includes(status)) return bad(c, 'BAD_STATUS', 'status must be published|rejected|flagged.');
  const registry = Registry.getInstance();
  const result = await registry.reviewRepo.moderate({ reviewId: id, status, moderatorId: (c.get('user') as any).id, reason: body?.reason ?? null, now: new Date() });
  if (!result) return bad(c, 'NOT_FOUND', 'Review not found.', 404);
  await new CreateAuditLogUseCase(registry.auditRepo).execute({ actorId: (c.get('user') as any).id, action: `REVIEW_${status.toUpperCase()}`, entity: 'review', entityId: id, newState: { status } });
  return ok(c, { productId: result.productId, status });
});

// ---- U4: creators ------------------------------------------------------
routes.get('/creators', requirePermissions([PERMISSIONS.PRICING_READ]), async (c) => {
  return ok(c, await Registry.getInstance().creatorRepo.adminOverview());
});

// ---- U5: flash sales ---------------------------------------------------
routes.get('/flash-sales', requirePermissions([PERMISSIONS.PRICING_READ]), async (c) => {
  return ok(c, await Registry.getInstance().flashSaleRepo.adminList());
});

// ---- U6: SEO -----------------------------------------------------------
routes.get('/seo', requirePermissions([PERMISSIONS.PRODUCTS_READ]), async (c) => {
  const registry = Registry.getInstance();
  const [redirects, sitemapCount, clicks] = await Promise.all([
    registry.seoRepo.listRedirects(),
    registry.seoRepo.countSitemapProducts(),
    registry.seoRepo.clicksByProductLast28Days(new Date()),
  ]);
  return ok(c, { redirects, sitemapProductCount: sitemapCount, gscClicksByProduct: clicks });
});

export default routes;
