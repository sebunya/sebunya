import { Hono } from 'hono';
import { z } from 'zod';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';
import { Registry } from '../../../../infrastructure/Registry';
import { PricingGovernanceError } from '../../../../application/use-cases/pricing/PricingGovernanceUseCase';
import { PricingOperationsError } from '../../../../application/use-cases/pricing/PricingOperationsUseCase';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { requireStepUp } from '../../middleware/requireStepUp';
import { STOREFRONT_PRICE_FLOOR_UGX } from '@goldplus/shared';

// audit-exempt: every commercial mutation delegates to Pricing governance/operations, which writes shared audit evidence.
const routes = new Hono<{ Variables: { user?: { id: string; email: string; permissions: string[] } } }>();
routes.use('*', authMiddleware);
const actor = (c: any) => (c.get('user') as { id: string }).id;

const condition = z.object({ type: z.enum(['MIN_CART_SUBTOTAL', 'PRODUCT_INCLUDED', 'CATEGORY_INCLUDED', 'CUSTOMER_DNA_SEGMENT', 'EXPERIMENT_VARIANT']), value: z.union([z.string().trim().min(1).max(200), z.number().int().min(0)]) });
const benefit = z.object({ type: z.enum(['PERCENTAGE_OFF', 'FIXED_AMOUNT_OFF', 'FIXED_PRICE', 'FREE_SHIPPING']), value: z.number().int().min(0), targetProductIds: z.array(z.string().uuid()).max(100).optional(), maximumDiscountUgx: z.number().int().min(0).nullable().optional() });
const exclusion = z.object({ type: z.enum(['PRODUCT', 'CATEGORY', 'CUSTOMER_DNA_SEGMENT']), value: z.string().trim().min(1).max(200) });
const version = z.object({
  conditions: z.array(condition).max(50), benefits: z.array(benefit).min(1).max(10), exclusions: z.array(exclusion).max(50),
  schedule: z.object({ startsAt: z.coerce.date(), endsAt: z.coerce.date() }),
  usagePolicy: z.object({ globalLimit: z.number().int().min(1).nullable(), perCustomerLimit: z.number().int().min(1).nullable(), perCouponLimit: z.number().int().min(1).nullable(), reservationTtlSeconds: z.number().int().min(60).max(86_400) }),
  priority: z.number().int().min(0).max(10_000), stackable: z.boolean(), couponCode: z.string().trim().min(3).max(40).nullable().optional(), priceFloorUgx: z.number().int().min(STOREFRONT_PRICE_FLOOR_UGX),
});
const createBody = z.object({ key: z.string().regex(/^[a-z0-9_-]{2,80}$/i), name: z.string().trim().min(1).max(160), description: z.string().trim().min(1).max(4000), version });
const versionBody = z.object({ expectedRevision: z.number().int().min(1), version });
const transitionBody = z.object({ versionId: z.string().uuid(), expectedRevision: z.number().int().min(1), reason: z.string().trim().min(3).max(1000) });
const simulationBody = z.object({ items: z.array(z.object({ productId: z.string().uuid(), quantity: z.number().int().min(1).max(99) })).min(1).max(50), couponCode: z.string().trim().min(3).max(40).nullable().optional(), customerDnaSegments: z.array(z.string().trim().min(1).max(120)).max(50).optional(), experimentEvidence: z.array(z.object({ experimentId: z.string().uuid(), variantKey: z.string().trim().min(1).max(40) })).max(20).optional(), shippingUgx: z.number().int().min(0).optional(), taxUgx: z.number().int().min(0).optional() });

function failure(c: any, error: unknown) {
  const known = error instanceof PricingGovernanceError || error instanceof PricingOperationsError;
  const code = known ? error.code : 'PRICING_OPERATION_FAILED';
  const status = code.includes('NOT_FOUND') ? 404 : ['STALE_VERSION', 'INVALID_TRANSITION', 'ACTIVATION_DENIED', 'VERSION_IMMUTABLE'].includes(code) ? 409 : 400;
  return c.json({ success: false, error: { code, message: error instanceof Error ? error.message : 'Pricing operation failed.' } } satisfies ApiResponse<never>, status);
}

routes.get('/overview', requirePermissions([PERMISSIONS.PRICING_READ], 'PERMISSION_DENIED'), async (c) => c.json({ success: true, data: await Registry.getInstance().pricingOperationsUseCase.overview() }));
routes.get('/definitions', requirePermissions([PERMISSIONS.PRICING_READ], 'PERMISSION_DENIED'), async (c) => c.json({ success: true, data: await Registry.getInstance().pricingOperationsUseCase.list() }));
routes.get('/definitions/:id', requirePermissions([PERMISSIONS.PRICING_READ], 'PERMISSION_DENIED'), async (c) => { try { return c.json({ success: true, data: await Registry.getInstance().pricingOperationsUseCase.detail(String(c.req.param('id'))) }); } catch (error) { return failure(c, error); } });

routes.post('/definitions', requirePermissions([PERMISSIONS.PRICING_CREATE], 'PERMISSION_DENIED'), async (c) => {
  const parsed = createBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? 'Invalid promotion.' } }, 400);
  try { return c.json({ success: true, data: await Registry.getInstance().pricingOperationsUseCase.create({ ...parsed.data, actorId: actor(c), version: { ...parsed.data.version, couponCode: parsed.data.version.couponCode ?? null } }) }, 201); } catch (error) { return failure(c, error); }
});
routes.post('/definitions/:id/versions', requirePermissions([PERMISSIONS.PRICING_MANAGE], 'PERMISSION_DENIED'), async (c) => {
  const parsed = versionBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? 'Invalid version.' } }, 400);
  try { return c.json({ success: true, data: await Registry.getInstance().pricingOperationsUseCase.createVersion({ definitionId: String(c.req.param('id')), expectedRevision: parsed.data.expectedRevision, actorId: actor(c), version: { ...parsed.data.version, couponCode: parsed.data.version.couponCode ?? null } }) }, 201); } catch (error) { return failure(c, error); }
});

const transitions = [
  ['submit', 'READY_FOR_REVIEW', PERMISSIONS.PRICING_MANAGE], ['approve', 'APPROVED', PERMISSIONS.PRICING_APPROVE], ['reject', 'REJECTED', PERMISSIONS.PRICING_APPROVE],
  ['activate', 'ACTIVE', PERMISSIONS.PRICING_ACTIVATE], ['pause', 'PAUSED', PERMISSIONS.PRICING_PAUSE], ['resume', 'ACTIVE', PERMISSIONS.PRICING_ACTIVATE], ['archive', 'ARCHIVED', PERMISSIONS.PRICING_MANAGE],
] as const;
// Slice 3C: price approval and activation move money for every customer, so
// they require a fresh MFA step-up on top of the permission (self-bypass denied).
// 'resume' moves PAUSED -> ACTIVE through the same path as activate, including
// lifting a budget auto-pause; it needs the same step-up.
const STEP_UP_OPERATIONS = new Set(['approve', 'activate', 'resume']);
for (const [operation, to, permission] of transitions) {
  const handler = async (c: any) => {
    const parsed = transitionBody.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? 'Invalid transition.' } }, 400);
    try { return c.json({ success: true, data: await Registry.getInstance().pricingOperationsUseCase.transition({ definitionId: String(c.req.param('id')), ...parsed.data, to, actorId: actor(c) }) }); } catch (error) { return failure(c, error); }
  };
  const path = `/definitions/:id/${operation}`;
  const perm = requirePermissions([permission], 'PERMISSION_DENIED');
  // Price approval and activation move money for every customer, so they need a
  // fresh MFA step-up on top of the permission (self-bypass denied).
  if (STEP_UP_OPERATIONS.has(operation)) {
    routes.post(path, perm, requireStepUp('pricing_approval'), handler);
  } else {
    routes.post(path, perm, handler);
  }
}

routes.post('/definitions/:id/experiment-associations', requirePermissions([PERMISSIONS.PRICING_MANAGE], 'PERMISSION_DENIED'), async (c) => {
  const parsed = z.object({ versionId: z.string().uuid(), experimentId: z.string().uuid(), variantKey: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: 'Version, experiment and variant are required.' } }, 400);
  try { return c.json({ success: true, data: await Registry.getInstance().pricingOperationsUseCase.associateExperiment({ definitionId: String(c.req.param('id')), ...parsed.data, actorId: actor(c) }) }); } catch (error) { return failure(c, error); }
});

routes.post('/simulate', requirePermissions([PERMISSIONS.PRICING_SIMULATE], 'PERMISSION_DENIED'), async (c) => {
  const parsed = simulationBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ success: false, error: { code: 'INVALID_BODY', message: parsed.error.issues[0]?.message ?? 'Invalid simulation.' } }, 400);
  try { return c.json({ success: true, data: await Registry.getInstance().pricingOperationsUseCase.simulate(parsed.data) }); } catch (error) { return failure(c, error); }
});

export default routes;
