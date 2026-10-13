import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { PERMISSIONS } from '@goldplus/shared';
import { Registry } from '../../../../infrastructure/Registry';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { carePushStore } from '../../../../infrastructure/assistant/GoldieChannelAdapters';
import { vapidFromEnv } from '../../../../infrastructure/assistant/WebPush';

/**
 * The Care Desk (0178): the shop attendants' and care team's one screen.
 * Reading the queue needs customer_data.view (names and numbers); working it
 * (done, assign, log a task) needs orders.manage; the team list and alerts
 * need settings.manage. Every change is audited.
 */
const routes = new Hono();
routes.use('*', authMiddleware);

const ok = <T>(c: Context, data: T) => c.json({ success: true, data });
const bad = (c: Context, code: string, message: string, status = 400) => c.json({ success: false, error: { code, message } }, status as 400);
const actor = (c: Context): string => (c.get('user') as { id: string }).id;
const UUID = /^[0-9a-f-]{36}$/i;
const KINDS = ['callback', 'follow_up', 'order_change', 'order_problem', 'bulk_lead', 'urgent'] as const;
const audit = (c: Context, action: string, entityId: string, newState: unknown) =>
  Registry.getInstance().createAuditLogUseCase.execute({ actorId: actor(c), action, entity: 'care_task', entityId, previousState: null, newState }).catch(() => undefined);

routes.get('/today', requirePermissions([PERMISSIONS.CUSTOMER_DATA_VIEW]), async (c) => ok(c, await Registry.getInstance().careDeskUseCases.today()));

routes.get('/tasks', requirePermissions([PERMISSIONS.CUSTOMER_DATA_VIEW]), async (c) => {
  const status = c.req.query('status');
  const kind = c.req.query('kind');
  return ok(c, await Registry.getInstance().careDeskUseCases.list({
    status: status === 'done' || status === 'cancelled' ? status : 'open',
    kind: (KINDS as readonly string[]).includes(kind ?? '') ? (kind as (typeof KINDS)[number]) : undefined,
    limit: Math.min(Number(c.req.query('limit') ?? 100) || 100, 300),
  }));
});

routes.post('/tasks', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const parsed = z.object({
    kind: z.enum(KINDS), title: z.string().min(3).max(200), detail: z.string().max(4000).nullable().optional(),
    customerName: z.string().max(120).nullable().optional(), customerPhone: z.string().max(40).nullable().optional(), orderNumber: z.string().max(40).nullable().optional(),
    urgent: z.boolean().optional(),
  }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, 'INVALID_BODY', parsed.error.issues[0]?.message ?? 'Invalid body.');
  // Who opened it is in the audit entry below; the column says only that staff did (it is varchar(40), a uuid would not fit).
  const out = await Registry.getInstance().careDeskUseCases.openTask({ ...parsed.data, openedBy: 'staff' });
  if (!out.ok) return bad(c, out.code, out.message);
  await audit(c, 'CARE_TASK_OPENED', out.task.id, { kind: parsed.data.kind });
  return ok(c, { id: out.task.id, alerted: out.alerted });
});

routes.post('/tasks/:id/resolve', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const id = c.req.param('id') ?? '';
  const parsed = z.object({ status: z.enum(['done', 'cancelled']), resolution: z.string().max(1000).nullable().optional() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || !UUID.test(id)) return bad(c, 'INVALID_BODY', 'Say done or cancelled.');
  if (!(await Registry.getInstance().careDeskUseCases.resolve(id, parsed.data.status, actor(c), parsed.data.resolution ?? null))) return bad(c, 'NOT_FOUND', 'That task is already closed or does not exist.', 404);
  await audit(c, parsed.data.status === 'done' ? 'CARE_TASK_DONE' : 'CARE_TASK_CANCELLED', id, { resolution: parsed.data.resolution ?? null });
  return ok(c, { id, status: parsed.data.status });
});

routes.post('/tasks/:id/assign', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const id = c.req.param('id') ?? '';
  const parsed = z.object({ toMe: z.boolean() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || !UUID.test(id)) return bad(c, 'INVALID_BODY', 'Invalid body.');
  if (!(await Registry.getInstance().careDeskUseCases.assign(id, parsed.data.toMe ? actor(c) : null))) return bad(c, 'NOT_FOUND', 'No such task.', 404);
  await audit(c, 'CARE_TASK_ASSIGNED', id, { toMe: parsed.data.toMe });
  return ok(c, { id });
});

routes.get('/team', requirePermissions([PERMISSIONS.CUSTOMER_DATA_VIEW]), async (c) => ok(c, await Registry.getInstance().careDeskUseCases.team()));

const duty = z.object({ days: z.array(z.number().int().min(0).max(6)).max(7).optional(), from: z.string().regex(/^\d{1,2}:\d{2}$/).optional(), to: z.string().regex(/^\d{1,2}:\d{2}$/).optional() }).nullable().optional();
routes.put('/team', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const parsed = z.object({
    id: z.string().uuid().nullable().optional(), name: z.string().max(80), roleLabel: z.string().max(60).nullable().optional(),
    phone: z.string().max(40).nullable().optional(), email: z.string().max(200).nullable().optional(),
    alertSms: z.boolean(), alertEmail: z.boolean(), alertWhatsapp: z.boolean(), onDuty: duty, active: z.boolean(),
  }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, 'INVALID_BODY', parsed.error.issues[0]?.message ?? 'Invalid body.');
  const out = await Registry.getInstance().careDeskUseCases.saveMember(parsed.data);
  if (!out.ok) return bad(c, 'BAD_INPUT', out.message);
  await Registry.getInstance().createAuditLogUseCase.execute({ actorId: actor(c), action: 'CARE_TEAM_MEMBER_SAVED', entity: 'care_team_member', entityId: out.member.id, previousState: null, newState: { name: out.member.name, active: out.member.active } }).catch(() => undefined);
  return ok(c, out.member);
});

routes.delete('/team/:id', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const id = c.req.param('id') ?? '';
  if (!UUID.test(id) || !(await Registry.getInstance().careDeskUseCases.removeMember(id))) return bad(c, 'NOT_FOUND', 'No such team member.', 404);
  await Registry.getInstance().createAuditLogUseCase.execute({ actorId: actor(c), action: 'CARE_TEAM_MEMBER_REMOVED', entity: 'care_team_member', entityId: id, previousState: null, newState: null }).catch(() => undefined);
  return ok(c, { id });
});

routes.post('/team/test-alert', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const sent = await Registry.getInstance().careDeskUseCases.testAlert();
  await Registry.getInstance().createAuditLogUseCase.execute({ actorId: actor(c), action: 'CARE_TEST_ALERT_SENT', entity: 'care_team_member', entityId: 'all', previousState: null, newState: { sent } }).catch(() => undefined);
  return ok(c, { sent });
});

// ---- notes on a task, saved replies, shift handover
routes.post('/tasks/:id/notes', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const id = c.req.param('id') ?? '';
  const parsed = z.object({ note: z.string().min(2).max(2000) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || !UUID.test(id)) return bad(c, 'INVALID_BODY', 'Write a note.');
  if (!(await Registry.getInstance().careDeskUseCases.addNote(id, actor(c), parsed.data.note))) return bad(c, 'NOT_FOUND', 'No such task.', 404);
  await audit(c, 'CARE_TASK_NOTE_ADDED', id, null);
  return ok(c, { id });
});
routes.get('/tasks/notes', requirePermissions([PERMISSIONS.CUSTOMER_DATA_VIEW]), async (c) => {
  const ids = String(c.req.query('ids') ?? '').split(',').filter((x) => UUID.test(x)).slice(0, 300);
  return ok(c, await Registry.getInstance().careDeskUseCases.notesFor(ids));
});
routes.get('/saved-replies', requirePermissions([PERMISSIONS.CUSTOMER_DATA_VIEW]), async (c) => ok(c, await Registry.getInstance().careDeskUseCases.savedReplies()));
routes.put('/saved-replies', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const parsed = z.object({ id: z.string().uuid().nullable().optional(), title: z.string().max(80), body: z.string().max(2000) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, 'INVALID_BODY', 'Invalid body.');
  const out = await Registry.getInstance().careDeskUseCases.saveReply({ ...parsed.data, createdBy: actor(c) });
  if (!out.ok) return bad(c, 'BAD_INPUT', out.message);
  await Registry.getInstance().createAuditLogUseCase.execute({ actorId: actor(c), action: 'CARE_SAVED_REPLY_SAVED', entity: 'care_saved_reply', entityId: out.id, previousState: null, newState: { title: parsed.data.title } }).catch(() => undefined);
  return ok(c, { id: out.id });
});
routes.delete('/saved-replies/:id', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const id = c.req.param('id') ?? '';
  if (!UUID.test(id) || !(await Registry.getInstance().careDeskUseCases.removeReply(id))) return bad(c, 'NOT_FOUND', 'No such reply.', 404);
  await Registry.getInstance().createAuditLogUseCase.execute({ actorId: actor(c), action: 'CARE_SAVED_REPLY_REMOVED', entity: 'care_saved_reply', entityId: id, previousState: null, newState: null }).catch(() => undefined);
  return ok(c, { id });
});
routes.post('/saved-replies/:id/used', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  // audit-exempt: a usage counter, no customer data and no decision.
  const id = c.req.param('id') ?? '';
  if (!UUID.test(id)) return bad(c, 'INVALID_BODY', 'Bad id.');
  await Registry.getInstance().careDeskUseCases.usedReply(id);
  return ok(c, { id });
});
routes.get('/handover', requirePermissions([PERMISSIONS.CUSTOMER_DATA_VIEW]), async (c) => ok(c, await Registry.getInstance().careDeskUseCases.recentHandovers(5)));
routes.post('/handover', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const parsed = z.object({ note: z.string().min(3).max(2000) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, 'INVALID_BODY', 'Write what the next shift needs to know.');
  await Registry.getInstance().careDeskUseCases.addHandover(actor(c), parsed.data.note);
  await Registry.getInstance().createAuditLogUseCase.execute({ actorId: actor(c), action: 'CARE_HANDOVER_NOTE_ADDED', entity: 'care_handover_note', entityId: 'desk', previousState: null, newState: null }).catch(() => undefined);
  return ok(c, { added: true });
});

// ---- Push alerts to staff phones (Web Push, VAPID)
routes.get('/push-key', requirePermissions([PERMISSIONS.CUSTOMER_DATA_VIEW]), async (c) => {
  const keys = vapidFromEnv();
  return ok(c, { publicKey: keys?.publicKey ?? null, subscribed: keys ? await carePushStore.count() : 0 });
});
routes.put('/push-subscriptions', requirePermissions([PERMISSIONS.CUSTOMER_DATA_VIEW]), async (c) => {
  const parsed = z.object({ endpoint: z.string().url().max(2000).refine((u) => u.startsWith('https://')), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }), label: z.string().max(80).nullable().optional() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, 'INVALID_BODY', 'Not a push subscription.');
  await carePushStore.save(actor(c), { endpoint: parsed.data.endpoint, ...parsed.data.keys }, parsed.data.label ?? null);
  await Registry.getInstance().createAuditLogUseCase.execute({ actorId: actor(c), action: 'CARE_PUSH_SUBSCRIBED', entity: 'care_push_subscription', entityId: 'self', previousState: null, newState: { label: parsed.data.label ?? null } }).catch(() => undefined);
  return ok(c, { subscribed: true });
});
routes.delete('/push-subscriptions', requirePermissions([PERMISSIONS.CUSTOMER_DATA_VIEW]), async (c) => {
  const parsed = z.object({ endpoint: z.string().max(2000) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, 'INVALID_BODY', 'Invalid body.');
  await carePushStore.remove(parsed.data.endpoint);
  await Registry.getInstance().createAuditLogUseCase.execute({ actorId: actor(c), action: 'CARE_PUSH_UNSUBSCRIBED', entity: 'care_push_subscription', entityId: 'self', previousState: null, newState: null }).catch(() => undefined);
  return ok(c, { subscribed: false });
});

export default routes;
