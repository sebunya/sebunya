import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';

/**
 * Customer DNA & NBA admin surface. Read is customer_dna.read / nba.read; profile
 * recompute is customer_dna.manage; NBA generation is nba.recompute; conflict
 * review is identity.review. Deny-by-default; every write audits in its use case.
 *
 * audit-exempt: the recompute and NBA-generate mutations delegate auditing to
 * their use cases (CreateAuditLogUseCase), a dedicated audit channel. Viewing
 * one profile is audited too (0157): no audit row, no profile.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

// A malformed customer id is a 404, never a Postgres cast error (a 500).
const CUSTOMER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = (c: any) => c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Customer profile not found.' } } satisfies ApiResponse<never>, 404);

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
  if (!CUSTOMER_ID.test(id)) return notFound(c);
  const reg = Registry.getInstance();
  const result = await reg.getCustomerDnaUseCase.execute(id);
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 404);
  const recorded = await reg.getCustomer360UseCase.recordView({ canonicalCustomerId: id, viewerId: String((c.get('user') as any)?.id ?? ''), surface: 'customer_dna' });
  if (!recorded) return c.json({ success: false, error: { code: 'AUDIT_UNAVAILABLE', message: 'This profile cannot be shown right now because the view could not be recorded.' } } satisfies ApiResponse<never>, 503);
  return c.json({ success: true, data: result } satisfies ApiResponse<typeof result>);
});

routes.post('/:id/recompute', requirePermissions([PERMISSIONS.CUSTOMER_DNA_MANAGE]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  if (!CUSTOMER_ID.test(id)) return notFound(c);
  const actorId = (c.get('user') as any).id as string;
  const result = await Registry.getInstance().projectCustomerProfileUseCase.execute({ canonicalCustomerId: id, actorId });
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 404);
  return c.json({ success: true, data: result } satisfies ApiResponse<typeof result>);
});

const nbaBody = z.object({ activationChannel: z.string().max(40).optional() }).optional();
// 0157: the context is read from the customer's real records (consent per
// channel, open support tickets, fraud cases, recent purchases, messages sent)
// by DecideNextBestActionUseCase — no placeholder defaults here.
routes.post('/:id/nba', requirePermissions([PERMISSIONS.NBA_RECOMPUTE]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  if (!CUSTOMER_ID.test(id)) return notFound(c);
  const actorId = (c.get('user') as any).id as string;
  const parsed = nbaBody.safeParse(await c.req.json().catch(() => ({})));
  const result = await Registry.getInstance().decideNextBestActionUseCase.execute({
    canonicalCustomerId: id, actorId, activationChannel: parsed.success ? (parsed.data?.activationChannel ?? null) : null,
  });
  if (!result.ok) return c.json({ success: false, error: { code: result.code, message: result.message } } satisfies ApiResponse<never>, 404);
  return c.json({ success: true, data: result } satisfies ApiResponse<typeof result>);
});

export default routes;
