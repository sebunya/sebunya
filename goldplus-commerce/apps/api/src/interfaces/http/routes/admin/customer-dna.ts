import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';
import { buildProfileDrivenCandidates, NbaContext } from '../../../../domain/customer-dna/NextBestAction';
import { numericFeature } from '../../../../domain/customer-dna/CustomerFeatures';

/**
 * Customer DNA & NBA admin surface. Read is customer_dna.read / nba.read; profile
 * recompute is customer_dna.manage; NBA generation is nba.recompute; conflict
 * review is identity.review. Deny-by-default; every write audits in its use case.
 *
 * audit-exempt: the recompute and NBA-generate mutations delegate auditing to
 * their use cases (CreateAuditLogUseCase), a dedicated audit channel.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

routes.get('/', requirePermissions([PERMISSIONS.CUSTOMER_DNA_READ]), async (c) => {
  const q = c.req.query('q') ?? '';
  const limit = Number(c.req.query('limit') ?? '25');
  const results = await Registry.getInstance().getCustomerDnaUseCase.search(q, Number.isFinite(limit) ? limit : 25);
  return c.json({ success: true, data: { results } } satisfies ApiResponse<{ results: typeof results }>);
});

routes.get('/conflicts', requirePermissions([PERMISSIONS.IDENTITY_REVIEW]), async (c) => {
  const conflicts = await Registry.getInstance().getCustomerDnaUseCase.listConflicts(50);
  return c.json({ success: true, data: { conflicts } } satisfies ApiResponse<{ conflicts: typeof conflicts }>);
});

routes.get('/:id', requirePermissions([PERMISSIONS.CUSTOMER_DNA_READ]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  const result = await Registry.getInstance().getCustomerDnaUseCase.execute(id);
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 404);
  return c.json({ success: true, data: result } satisfies ApiResponse<typeof result>);
});

routes.post('/:id/recompute', requirePermissions([PERMISSIONS.CUSTOMER_DNA_MANAGE]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  const actorId = (c.get('user') as any).id as string;
  const result = await Registry.getInstance().projectCustomerProfileUseCase.execute({ canonicalCustomerId: id, actorId });
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 404);
  return c.json({ success: true, data: result } satisfies ApiResponse<typeof result>);
});

const nbaBody = z.object({ activationChannel: z.string().max(40).optional() }).optional();
routes.post('/:id/nba', requirePermissions([PERMISSIONS.NBA_RECOMPUTE]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  const actorId = (c.get('user') as any).id as string;
  const parsed = nbaBody.safeParse(await c.req.json().catch(() => ({})));
  const reg = Registry.getInstance();

  const dna = await reg.getCustomerDnaUseCase.execute(id);
  if (!dna.ok) return c.json({ success: false, error: { code: dna.code, message: dna.message } } satisfies ApiResponse<never>, 404);

  const feats = dna.features?.features ?? [];
  const candidates = buildProfileDrivenCandidates({
    lifecycleStage: dna.lifecycle?.stage ?? dna.profile.primaryLifecycleStage,
    cartAbandonments: numericFeature(feats as any, 'cart_abandonments') ?? 0,
    backorderExposure: numericFeature(feats as any, 'backorder_exposure') ?? 0,
    riskFlags: dna.profile.riskFlags,
    daysSinceLastOrder: numericFeature(feats as any, 'days_since_last_order'),
  });

  // Consent-gated: consent-requiring actions only fire when consent is truthfully
  // known-eligible; operational actions (resume cart, delivery follow-up) do not.
  const context: NbaContext = {
    consentEligible: dna.profile.consentEligible === true,
    channelEligible: {},
    activationChannel: parsed.success ? (parsed.data?.activationChannel ?? null) : null,
    openSupportCase: false,
    fraudHold: dna.profile.riskFlags.includes('FRAUD_HOLD'),
    frequencyCapReached: false,
    recentPurchaseRefs: [],
    outOfStockRefs: [],
    incompatibleRefs: [],
    invalidPromotionRefs: [],
    policyVersion: 1,
  };

  const result = await reg.generateNextBestActionUseCase.execute({ canonicalCustomerId: id, actorId, candidates, context });
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 404);
  return c.json({ success: true, data: result } satisfies ApiResponse<typeof result>);
});

export default routes;
