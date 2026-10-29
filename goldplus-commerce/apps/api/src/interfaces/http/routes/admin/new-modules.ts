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

// ---- Wave 2D: capability hub ------------------------------------------
// One honest snapshot for the orientation hub: real row counts, no derived
// health theatre. A capability with a schema but no code reports exactly that.
routes.get('/hub', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  return ok(c, { generatedAt: new Date().toISOString(), counts: await Registry.getInstance().capabilityHubReader.counts() });
});

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
  // A malformed id is simply not a review — never a Postgres cast error.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return bad(c, 'NOT_FOUND', 'Review not found.', 404);
  const body = await c.req.json().catch(() => null);
  const status = body?.status;
  if (!['published', 'rejected', 'flagged'].includes(status)) return bad(c, 'BAD_STATUS', 'status must be published|rejected|flagged.');
  const registry = Registry.getInstance();
  const result = await registry.reviewRepo.moderate({ reviewId: id, status, moderatorId: (c.get('user') as any).id, reason: body?.reason ?? null, now: new Date() });
  if (!result) return bad(c, 'NOT_FOUND', 'Review not found.', 404);
  await new CreateAuditLogUseCase(registry.auditRepo).execute({ actorId: (c.get('user') as any).id, action: `REVIEW_${status.toUpperCase()}`, entity: 'review', entityId: id, newState: { status } });
  return ok(c, { productId: result.productId, status });
});

/** 0209: a review's photo for the moderator, published or not. */
routes.get('/reviews/photos/:id', requirePermissions([PERMISSIONS.REVIEWS_MODERATE]), async (c) => {
  const image = await Registry.getInstance().reviewPhotoUseCases.image(String(c.req.param('id')), true);
  if (!image) return bad(c, 'NOT_FOUND', 'No such photo.', 404);
  return c.body(new Uint8Array(image.buffer as ArrayBuffer, image.byteOffset, image.byteLength), 200, { 'Content-Type': 'image/jpeg', 'Content-Length': String(image.byteLength), 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff' });
});

// ---- 0208: product questions (answer queue) ------------------------------
routes.get('/questions', requirePermissions([PERMISSIONS.REVIEWS_MODERATE]), async (c) => {
  const status = String(c.req.query('status') || 'pending');
  if (!['pending', 'answered', 'rejected'].includes(status)) return bad(c, 'BAD_STATUS', 'status must be pending|answered|rejected.');
  const registry = Registry.getInstance();
  const [items, counts] = await Promise.all([registry.productQuestionRepo.listByStatus(status as 'pending', 100), registry.productQuestionRepo.countByStatus()]);
  return ok(c, { items, counts });
});
routes.post('/questions/:id/answer', requirePermissions([PERMISSIONS.REVIEWS_MODERATE]), async (c) => {
  const id = String(c.req.param('id'));
  const body = await c.req.json().catch(() => null);
  const registry = Registry.getInstance();
  const result = await registry.answerProductQuestionUseCase.execute({ id, answer: body?.answer, answeredBy: (c.get('user') as any).id });
  if (!result.ok) {
    if (result.reason === 'NOT_FOUND') return bad(c, 'NOT_FOUND', 'Question not found.', 404);
    if (result.reason === 'ALREADY') return bad(c, 'ALREADY_ANSWERED', 'That question already has an answer.', 409);
    return bad(c, 'BAD_ANSWER', 'Write the answer in 2 to 1,500 characters.');
  }
  await new CreateAuditLogUseCase(registry.auditRepo).execute({ actorId: (c.get('user') as any).id, action: 'PRODUCT_QUESTION_ANSWERED', entity: 'product_question', entityId: id, newState: { status: 'answered', notified: result.notified, notice: result.notice } });
  return ok(c, { status: 'answered', notified: result.notified, notice: result.notice });
});
// A published answer corrected (stale price or stock, a typo). Not sent again; the audit keeps both wordings.
routes.post('/questions/:id/edit', requirePermissions([PERMISSIONS.REVIEWS_MODERATE]), async (c) => {
  const id = String(c.req.param('id'));
  const body = await c.req.json().catch(() => null);
  const registry = Registry.getInstance();
  const actorId = (c.get('user') as any).id;
  const result = await registry.answerProductQuestionUseCase.edit({ id, answer: body?.answer, editedBy: actorId });
  if (!result.ok) {
    if (result.reason === 'NOT_FOUND') return bad(c, 'NOT_FOUND', 'Question not found.', 404);
    if (result.reason === 'NOT_ANSWERED') return bad(c, 'NOT_ANSWERED', 'Only a published answer can be corrected.', 409);
    return bad(c, 'BAD_ANSWER', 'Write the answer in 2 to 1,500 characters.');
  }
  await new CreateAuditLogUseCase(registry.auditRepo).execute({ actorId, action: 'PRODUCT_QUESTION_ANSWER_EDITED', entity: 'product_question', entityId: id, previousState: { answer: result.previous }, newState: { answer: String(body?.answer ?? '').trim() } });
  return ok(c, { status: 'answered', edited: true });
});
// The answer sent to the asker when the first try could not be queued (never a second copy: the message key).
routes.post('/questions/:id/resend', requirePermissions([PERMISSIONS.REVIEWS_MODERATE]), async (c) => {
  const id = String(c.req.param('id'));
  const registry = Registry.getInstance();
  const result = await registry.answerProductQuestionUseCase.resend(id);
  if (!result.ok) {
    if (result.reason === 'NOT_FOUND') return bad(c, 'NOT_FOUND', 'Question not found.', 404);
    if (result.reason === 'NOT_ANSWERED') return bad(c, 'NOT_ANSWERED', 'Answer the question first.', 409);
    if (result.reason === 'NO_CONTACT') return bad(c, 'NO_CONTACT', 'The asker left no phone or email.', 409);
    return bad(c, 'ALREADY_SENT', 'The answer was already sent to the asker.', 409);
  }
  await new CreateAuditLogUseCase(registry.auditRepo).execute({ actorId: (c.get('user') as any).id, action: 'PRODUCT_QUESTION_ANSWER_RESENT', entity: 'product_question', entityId: id, newState: { notice: result.notice } });
  return ok(c, { notice: result.notice });
});
routes.post('/questions/:id/reject', requirePermissions([PERMISSIONS.REVIEWS_MODERATE]), async (c) => {
  const id = String(c.req.param('id'));
  const registry = Registry.getInstance();
  if (!(await registry.answerProductQuestionUseCase.reject(id, (c.get('user') as any).id))) return bad(c, 'NOT_FOUND', 'Question not found.', 404);
  await new CreateAuditLogUseCase(registry.auditRepo).execute({ actorId: (c.get('user') as any).id, action: 'PRODUCT_QUESTION_REJECTED', entity: 'product_question', entityId: id, newState: { status: 'rejected' } });
  return ok(c, { status: 'rejected' });
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
