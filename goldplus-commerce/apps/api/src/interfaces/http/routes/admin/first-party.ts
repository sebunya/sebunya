import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { runFirstPartyNightlyOnce } from '../../../../infrastructure/scheduler/FirstPartyNightlyTicker';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';

/**
 * First-party data admin (0155/0157): segments, the customer value (LTV) report,
 * identity conflict review, the analysis-exclusion status, the Customer 360
 * and customers' privacy requests. Reads need customer_dna.read /
 * analytics.read / identity.review; ONE customer's full profile needs
 * customer_data.view (every view audited in GetCustomer360UseCase); privacy
 * requests need privacy_requests.manage. Changes need customer_dna.manage,
 * identity.review or privacy_requests.manage. Deny-by-default.
 *
 * audit-exempt: every mutation audits inside its use case
 * (ManageSegmentsUseCase, ResolveIdentityConflictUseCase, PrivacyRequestUseCases
 * via CreateAuditLogUseCase); "run now" writes a customer_segment_runs row as its record.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actorOf = (c: any): string => String((c.get('user') as { id?: string } | undefined)?.id ?? '');
const bad = (c: any, code: string, message: string, status: 400 | 403 | 404 | 409 | 503 = 400, errors?: string[]) =>
  c.json({ success: false, error: { code, message, ...(errors ? { details: errors } : {}) } } satisfies ApiResponse<never>, status);

const segmentBody = z.object({
  name: z.string().max(120),
  description: z.string().max(1000).nullish(),
  definition: z.unknown(),
});

routes.get('/segments', requirePermissions([PERMISSIONS.CUSTOMER_DNA_READ]), async (c) => {
  const reg = Registry.getInstance();
  const [segments, runs, categories] = await Promise.all([
    reg.manageSegmentsUseCase.list(c.req.query('archived') === '1'),
    reg.manageSegmentsUseCase.runs(10),
    reg.manageSegmentsUseCase.categories().catch(() => []),
  ]);
  return c.json({ success: true, data: { segments, runs, categories } });
});

routes.post('/segments', requirePermissions([PERMISSIONS.CUSTOMER_DNA_MANAGE]), async (c) => {
  const parsed = segmentBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, 'BAD_INPUT', 'Name and rules are required.');
  const r = await Registry.getInstance().manageSegmentsUseCase.create({ name: parsed.data.name, description: parsed.data.description ?? null, definition: parsed.data.definition, actorId: actorOf(c) });
  if (!r.ok) return bad(c, r.code, r.message, r.code === 'DUPLICATE' ? 409 : 400, r.errors);
  return c.json({ success: true, data: r.segment }, 201);
});

routes.post('/segments/preview', requirePermissions([PERMISSIONS.CUSTOMER_DNA_READ]), async (c) => {
  const body = await c.req.json().catch(() => null) as { definition?: unknown } | null;
  const r = await Registry.getInstance().manageSegmentsUseCase.preview(body?.definition);
  if (!r.ok) return bad(c, r.code, r.message, 400, r.errors);
  return c.json({ success: true, data: r });
});

routes.put('/segments/:id', requirePermissions([PERMISSIONS.CUSTOMER_DNA_MANAGE]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  if (!UUID.test(id)) return bad(c, 'NOT_FOUND', 'Segment not found.', 404);
  const parsed = segmentBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, 'BAD_INPUT', 'Name and rules are required.');
  const r = await Registry.getInstance().manageSegmentsUseCase.update(id, { name: parsed.data.name, description: parsed.data.description ?? null, definition: parsed.data.definition, actorId: actorOf(c) });
  if (!r.ok) return bad(c, r.code, r.message, r.code === 'NOT_FOUND' ? 404 : 400, r.errors);
  return c.json({ success: true, data: r.segment });
});

routes.post('/segments/:id/archive', requirePermissions([PERMISSIONS.CUSTOMER_DNA_MANAGE]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  if (!UUID.test(id)) return bad(c, 'NOT_FOUND', 'Segment not found.', 404);
  const body = await c.req.json().catch(() => ({})) as { archived?: boolean };
  const r = await Registry.getInstance().manageSegmentsUseCase.setArchived(id, body.archived !== false, actorOf(c));
  if (!r.ok) return bad(c, r.code, r.message, 404);
  return c.json({ success: true, data: { archived: body.archived !== false } });
});

routes.get('/segments/:id/members', requirePermissions([PERMISSIONS.CUSTOMER_DNA_READ]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  if (!UUID.test(id)) return bad(c, 'NOT_FOUND', 'Segment not found.', 404);
  const r = await Registry.getInstance().manageSegmentsUseCase.members(id, Number(c.req.query('limit') ?? 50) || 50);
  if (!r.ok) return bad(c, r.code, r.message, 404);
  return c.json({ success: true, data: r });
});

routes.post('/segments/run', requirePermissions([PERMISSIONS.CUSTOMER_DNA_MANAGE]), async (c) => {
  const outcome = await runFirstPartyNightlyOnce(new Date(), 'admin');
  if (outcome !== 'RAN') return bad(c, outcome, outcome === 'SKIPPED_LOCKED' || outcome === 'SKIPPED_BUSY' ? 'A run is already in progress. Try again in a few minutes.' : 'The run did not start.', 409);
  const [latest] = await Registry.getInstance().manageSegmentsUseCase.runs(1);
  return c.json({ success: true, data: { run: latest ?? null } });
});

routes.get('/customer-value', requirePermissions([PERMISSIONS.ANALYTICS_READ]), async (c) => {
  const report = await Registry.getInstance().getCustomerValueReportUseCase.execute({ cohortMonths: Number(c.req.query('months') ?? 12) || 12 });
  return c.json({ success: true, data: report });
});

routes.get('/identity-conflicts', requirePermissions([PERMISSIONS.IDENTITY_REVIEW]), async (c) => {
  const conflicts = await Registry.getInstance().listIdentityConflictsUseCase.execute(100);
  return c.json({ success: true, data: { conflicts } });
});

const resolveBody = z.object({ resolution: z.string().max(40), reason: z.string().max(1000) });
routes.post('/identity-conflicts/:id/resolve', requirePermissions([PERMISSIONS.IDENTITY_REVIEW]), async (c) => {
  const id = String(c.req.param('id') ?? '');
  if (!UUID.test(id)) return bad(c, 'NOT_FOUND', 'Conflict not found.', 404);
  const parsed = resolveBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, 'BAD_INPUT', 'Choose a resolution and give a reason.');
  const r = await Registry.getInstance().resolveIdentityConflictUseCase.execute({ conflictId: id, ...parsed.data, actorId: actorOf(c) });
  if (!r.ok) return bad(c, r.code, r.message, r.code === 'NOT_FOUND' ? 404 : r.code === 'ALREADY_RESOLVED' ? 409 : 400);
  return c.json({ success: true, data: r });
});

routes.get('/exclusions', requirePermissions([PERMISSIONS.ANALYTICS_READ]), async (c) => {
  const summary = await Registry.getInstance().trafficExclusionStore.summary();
  return c.json({ success: true, data: summary });
});

// ── Customer 360 (0157) ─────────────────────────────────────────────────────
routes.get('/customers/by-account/:userId', requirePermissions([PERMISSIONS.CUSTOMER_DATA_VIEW]), async (c) => {
  const canonicalCustomerId = await Registry.getInstance().getCustomer360UseCase.canonicalForAccount(String(c.req.param('userId') ?? ''));
  if (!canonicalCustomerId) return bad(c, 'NOT_FOUND', 'This account has no customer profile yet. One is created at their next sign-in or order.', 404);
  return c.json({ success: true, data: { canonicalCustomerId } });
});

routes.get('/customers/:id/360', requirePermissions([PERMISSIONS.CUSTOMER_DATA_VIEW]), async (c) => {
  const r = await Registry.getInstance().getCustomer360UseCase.execute({
    canonicalCustomerId: String(c.req.param('id') ?? ''), viewerId: actorOf(c), reason: c.req.query('reason') ?? null,
  });
  if (!r.ok) return bad(c, r.code, r.message, r.code === 'NOT_FOUND' ? 404 : 503);
  c.header('Cache-Control', 'private, no-store');
  return c.json({ success: true, data: r });
});

// ── Privacy requests (0157) ─────────────────────────────────────────────────
routes.get('/privacy-requests', requirePermissions([PERMISSIONS.PRIVACY_REQUESTS_MANAGE]), async (c) => {
  const requests = await Registry.getInstance().privacyRequestUseCases.list(c.req.query('status') ?? null);
  c.header('Cache-Control', 'private, no-store');
  return c.json({ success: true, data: { requests } });
});

const fulfilBody = z.object({ confirmation: z.string().max(20), reason: z.string().max(1000) });
routes.post('/privacy-requests/:id/fulfil', requirePermissions([PERMISSIONS.PRIVACY_REQUESTS_MANAGE]), async (c) => {
  const parsed = fulfilBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, 'BAD_INPUT', 'Type the reference and say how the request was checked.');
  const r = await Registry.getInstance().privacyRequestUseCases.fulfil({ requestId: String(c.req.param('id') ?? ''), actorId: actorOf(c), ...parsed.data });
  if (!r.ok) return bad(c, r.code, r.message, r.code === 'NOT_FOUND' ? 404 : r.code === 'NOT_OPEN' || r.code === 'OPEN_ORDERS' ? 409 : 400);
  return c.json({ success: true, data: r });
});

const declineBody = z.object({ reason: z.string().max(1000) });
routes.post('/privacy-requests/:id/decline', requirePermissions([PERMISSIONS.PRIVACY_REQUESTS_MANAGE]), async (c) => {
  const parsed = declineBody.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, 'BAD_INPUT', 'Give the customer a reason.');
  const r = await Registry.getInstance().privacyRequestUseCases.decline({ requestId: String(c.req.param('id') ?? ''), actorId: actorOf(c), reason: parsed.data.reason });
  if (!r.ok) return bad(c, r.code, r.message, r.code === 'NOT_FOUND' ? 404 : r.code === 'NOT_OPEN' ? 409 : 400);
  return c.json({ success: true, data: r });
});

export default routes;
