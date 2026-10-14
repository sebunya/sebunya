import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { PERMISSIONS } from '@goldplus/shared';
import { Registry } from '../../../../infrastructure/Registry';
import { META_GRAPH_VERSION } from '../../../../infrastructure/advertising/AdPlatforms';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { csvCell } from '../../csv';
import type { ArchiveChannel } from '../../../../domain/assistant/ConversationArchive';

/**
 * Shop-assistant operations: month spend, ledger counts, the policy (budget,
 * fairness, abuse ceilings, model) and the two switches. Reading needs
 * analytics.read; changing the policy needs settings.manage. Every save is
 * audited. audit-exempt: reads only; the PUT audits inline below.
 *
 * Conversations (0177): the archive of every Goldie chat on every channel.
 * Customer words and contacts, so customers.data.view to read (each thread
 * view is audited, like Customer 360); orders.manage to take over, reply or
 * set the outcome (audited).
 */
const routes = new Hono();
routes.use('*', authMiddleware);

const ok = <T>(c: Context, data: T) => c.json({ success: true, data });
const bad = (c: Context, code: string, message: string, status = 400) => c.json({ success: false, error: { code, message } }, status as 400);
const actor = (c: Context): string => (c.get('user') as { id: string }).id;

routes.get('/status', requirePermissions([PERMISSIONS.ANALYTICS_READ]), async (c) => ok(c, await Registry.getInstance().assistantAdmissionUseCases.status()));

routes.get('/config', requirePermissions([PERMISSIONS.ANALYTICS_READ]), async (c) => ok(c, await Registry.getInstance().assistantAdmissionUseCases.config()));

routes.put('/config', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const parsed = z.object({ expectedVersion: z.number().int().min(0), config: z.record(z.unknown()) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, 'INVALID_BODY', parsed.error.issues[0]?.message ?? 'Invalid body.');
  const registry = Registry.getInstance();
  const before = await registry.assistantAdmissionUseCases.config();
  const saved = await registry.assistantAdmissionUseCases.saveConfig(parsed.data.config, parsed.data.expectedVersion, actor(c));
  if (!saved) return bad(c, 'VERSION_CONFLICT', 'Someone else changed the assistant settings; reload and try again.', 409);
  const after = await registry.assistantAdmissionUseCases.config();
  await registry.createAuditLogUseCase.execute({
    actorId: actor(c), action: 'ASSISTANT_CONFIG_UPDATED', entity: 'assistant_config', entityId: 'global',
    previousState: { version: before.version, config: before.config }, newState: { version: saved.version, config: after.config },
  });
  return ok(c, { version: saved.version, config: after.config });
});

routes.get('/channels', requirePermissions([PERMISSIONS.ANALYTICS_READ]), async (c) => ok(c, { ...Registry.getInstance().goldieChannelUseCases.status(), ...Registry.getInstance().goldieSocialUseCases.status() }));

// ---- Answer memory ("Teach Goldie") and the route mix
routes.get('/answers', requirePermissions([PERMISSIONS.ANALYTICS_READ]), async (c) => ok(c, await Registry.getInstance().answerMemoryUseCases.list(c.req.query('retired') === '1')));
routes.get('/savings', requirePermissions([PERMISSIONS.ANALYTICS_READ]), async (c) => {
  const registry = Registry.getInstance();
  const days = Math.min(Math.max(Number(c.req.query('days') ?? 7) || 7, 1), 90);
  const [savings, status] = await Promise.all([registry.answerMemoryUseCases.savings(days), registry.assistantAdmissionUseCases.status().catch(() => null)]);
  // The month ahead at the recent pace: what is committed so far, plus the daily run rate for the days left (UTC month).
  const now = new Date();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const daysLeft = daysInMonth - now.getUTCDate() + 1;
  const committed = Number(status?.totals?.settledMicroUsd ?? 0) + Number(status?.totals?.reservedMicroUsd ?? 0);
  const perDay = savings.modelSpendMicroUsd / days;
  const cap = Number(status?.config?.monthlyCapMicroUsd ?? 0);
  const projected = Math.round(committed + perDay * daysLeft);
  return ok(c, { ...savings, forecast: { monthToDateMicroUsd: committed, projectedMonthMicroUsd: projected, capMicroUsd: cap, perDayMicroUsd: Math.round(perDay), overCap: cap > 0 && projected > cap } });
});
routes.post('/answers/:id', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const id = c.req.param('id') ?? '';
  const parsed = z.object({ answer: z.string().max(1500).optional(), pinned: z.boolean().optional(), retired: z.boolean().optional() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || !/^[0-9a-f-]{36}$/i.test(id)) return bad(c, 'INVALID_BODY', 'Invalid body.');
  const registry = Registry.getInstance();
  if (!(await registry.answerMemoryUseCases.edit(id, parsed.data))) return bad(c, 'NOT_FOUND', 'No such answer, or the answer is too short or too long.', 404);
  await registry.createAuditLogUseCase.execute({ actorId: actor(c), action: 'ASSISTANT_ANSWER_EDITED', entity: 'assistant_answer_memory', entityId: id, previousState: null, newState: parsed.data });
  return ok(c, { id });
});
routes.delete('/answers/:id', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const id = c.req.param('id') ?? '';
  const registry = Registry.getInstance();
  if (!/^[0-9a-f-]{36}$/i.test(id) || !(await registry.answerMemoryUseCases.remove(id))) return bad(c, 'NOT_FOUND', 'No such answer.', 404);
  await registry.createAuditLogUseCase.execute({ actorId: actor(c), action: 'ASSISTANT_ANSWER_DELETED', entity: 'assistant_answer_memory', entityId: id, previousState: null, newState: null });
  return ok(c, { id });
});

// ---- Weekly quality review
routes.get('/quality', requirePermissions([PERMISSIONS.CUSTOMER_DATA_VIEW]), async (c) => {
  const r = Registry.getInstance().qualityReviewUseCases;
  const [week, trend] = await Promise.all([r.thisWeek(), r.trend(8)]);
  return ok(c, { ...week, trend });
});
routes.post('/quality/:id', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const id = c.req.param('id') ?? '';
  const parsed = z.object({ score: z.number().int().min(1).max(5), accurate: z.boolean(), toneOk: z.boolean(), note: z.string().max(1000).nullable().optional() }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || !/^[0-9a-f-]{36}$/i.test(id)) return bad(c, 'INVALID_BODY', 'Give a score from 1 to 5 and the two checks.');
  const registry = Registry.getInstance();
  if (!(await registry.qualityReviewUseCases.review(id, { ...parsed.data, reviewerId: actor(c) }))) return bad(c, 'NOT_FOUND', 'No such review.', 404);
  await registry.createAuditLogUseCase.execute({ actorId: actor(c), action: 'ASSISTANT_QA_REVIEWED', entity: 'assistant_qa_review', entityId: id, previousState: null, newState: { score: parsed.data.score } });
  return ok(c, { id });
});

// ---- Conversations
const OUTCOMES = ['open', 'resolved', 'handed_over', 'needs_human'] as const;
const MOODS = ['upset', 'worried', 'confused', 'happy', 'neutral'] as const;
const filters = (c: Context) => {
  const q = c.req.query();
  const date = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00+03:00`) : undefined);
  const to = date(q.to); if (to) to.setUTCDate(to.getUTCDate() + 1);
  return {
    channel: ['web', 'whatsapp', 'messenger', 'instagram'].includes(String(q.channel)) ? (q.channel as ArchiveChannel) : undefined,
    outcome: (OUTCOMES as readonly string[]).includes(q.outcome ?? '') ? (q.outcome as (typeof OUTCOMES)[number]) : undefined,
    mood: (MOODS as readonly string[]).includes(q.mood ?? '') ? (q.mood as (typeof MOODS)[number]) : undefined,
    topic: q.topic && /^[A-Z_]{2,20}$/.test(q.topic) ? q.topic : undefined,
    q: q.q ? q.q.slice(0, 80) : undefined,
    from: date(q.from), to,
  };
};

routes.get('/conversations', requirePermissions([PERMISSIONS.CUSTOMER_DATA_VIEW]), async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 200), offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0);
  return ok(c, await Registry.getInstance().conversationArchiveUseCases.list({ ...filters(c), limit, offset }));
});

routes.get('/conversations/summary', requirePermissions([PERMISSIONS.CUSTOMER_DATA_VIEW]), async (c) => {
  const f = filters(c);
  const to = f.to ?? new Date(); const from = f.from ?? new Date(to.getTime() - 7 * 86400_000);
  return ok(c, await Registry.getInstance().conversationArchiveUseCases.summary(from, to));
});

routes.get('/conversations.csv', requirePermissions([PERMISSIONS.CUSTOMER_DATA_VIEW]), async (c) => {
  const { rows } = await Registry.getInstance().conversationArchiveUseCases.list({ ...filters(c), limit: 200, offset: 0 });
  const head = ['started', 'last message', 'channel', 'contact name', 'phone', 'email', 'first topic', 'last topic', 'mood', 'outcome', 'rating', 'messages', 'ai turns', 'support ticket', 'last customer line'];
  const lines = rows.map((r) => [r.startedAt.toISOString(), r.lastMessageAt.toISOString(), r.channel, r.contactName, r.contactPhone, r.contactEmail, r.firstTopic, r.lastTopic, r.worstMood, r.outcome, r.csat ?? '', r.messageCount, r.aiTurns, r.supportTicketId, r.lastCustomerLine].map(csvCell).join(','));
  // A bulk download of customer contacts: audited like viewing one conversation is.
  const f = filters(c);
  await Registry.getInstance().createAuditLogUseCase.execute({ actorId: (c.get('user') as { id: string }).id, action: 'GOLDIE_CONVERSATIONS_EXPORTED', entity: 'assistant_conversation', entityId: 'csv', previousState: null,
    newState: { rows: rows.length, channel: f.channel ?? null, outcome: f.outcome ?? null, from: f.from?.toISOString() ?? null, to: f.to?.toISOString() ?? null } }).catch(() => undefined);
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response([head.map(csvCell).join(','), ...lines].join('\r\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="goldie-conversations-${stamp}.csv"`, 'Cache-Control': 'no-store' } });
});

// A photo / voice note / video / document a customer sent on WhatsApp, fetched from Meta with the shop's token
// (the token never reaches the browser). Meta keeps media about 30 days. Read-only.
routes.get('/whatsapp-media/:id', requirePermissions([PERMISSIONS.CUSTOMER_DATA_VIEW]), async (c) => {
  const id = c.req.param('id') ?? '';
  if (!/^\d{5,30}$/.test(id)) return bad(c, 'INVALID_ID', 'Not a media id.');
  const token = (process.env.GOLDIE_WHATSAPP_TOKEN || '').trim() || (await Registry.getInstance().advertisingOps.whatsappAds.messagingToken().catch(() => null));
  if (!token) return bad(c, 'NOT_CONFIGURED', 'WhatsApp is not connected.', 503);
  const graph = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
  try {
    const meta = await fetch(`${graph}/${id}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    const info = (await meta.json().catch(() => null)) as { url?: string; mime_type?: string; file_size?: number } | null;
    if (!meta.ok || !info?.url) return bad(c, 'GONE', 'Meta no longer has this file (media is kept about 30 days).', 404);
    if (Number(info.file_size ?? 0) > 25 * 1024 * 1024) return bad(c, 'TOO_LARGE', 'The file is larger than 25 MB.', 413);
    // Only Meta's own media host, with the token.
    if (!/^https:\/\/[a-z0-9.-]+\.(fbsbx|facebook|whatsapp)\.(com|net)\//i.test(info.url)) return bad(c, 'GONE', 'Unexpected media address.', 502);
    const file = await fetch(info.url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    if (!file.ok || !file.body) return bad(c, 'GONE', 'Meta did not return the file.', 502);
    const type = String(info.mime_type ?? file.headers.get('content-type') ?? 'application/octet-stream').slice(0, 80);
    // A customer's photo or voice note is personal data: every view is on the audit log.
    await Registry.getInstance().createAuditLogUseCase.execute({ actorId: actor(c), action: 'WHATSAPP_MEDIA_VIEWED', entity: 'whatsapp_media', entityId: id, previousState: null, newState: { type } }).catch(() => undefined);
    return new Response(file.body, { status: 200, headers: { 'Content-Type': type, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': `inline; filename="whatsapp-${id}"`, 'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; media-src 'self'; sandbox" } });
  } catch {
    return bad(c, 'UPSTREAM_UNAVAILABLE', 'Meta could not be reached.', 502);
  }
});

routes.get('/conversations/:id', requirePermissions([PERMISSIONS.CUSTOMER_DATA_VIEW]), async (c) => {
  const id = c.req.param('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return bad(c, 'NOT_FOUND', 'No such conversation.', 404);
  const registry = Registry.getInstance();
  const found = await registry.conversationArchiveUseCases.get(id);
  if (!found) return bad(c, 'NOT_FOUND', 'No such conversation.', 404);
  await registry.createAuditLogUseCase.execute({ actorId: actor(c), action: 'ASSISTANT_CONVERSATION_VIEWED', entity: 'assistant_conversation', entityId: id, previousState: null, newState: null }).catch(() => undefined);
  return ok(c, found);
});

routes.post('/conversations/:id/takeover', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const id = c.req.param('id') ?? '';
  const parsed = z.object({ hours: z.number().min(0).max(72) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || !/^[0-9a-f-]{36}$/i.test(id)) return bad(c, 'INVALID_BODY', 'Send hours between 0 and 72.');
  const registry = Registry.getInstance();
  if (!(await registry.conversationArchiveUseCases.takeOver(id, parsed.data.hours))) return bad(c, 'NOT_FOUND', 'No such conversation.', 404);
  await registry.createAuditLogUseCase.execute({ actorId: actor(c), action: parsed.data.hours > 0 ? 'ASSISTANT_CONVERSATION_TAKEN_OVER' : 'ASSISTANT_CONVERSATION_RETURNED', entity: 'assistant_conversation', entityId: id, previousState: null, newState: { hours: parsed.data.hours } });
  return ok(c, { id, hours: parsed.data.hours });
});

routes.post('/conversations/:id/outcome', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const id = c.req.param('id') ?? '';
  const parsed = z.object({ outcome: z.enum(OUTCOMES) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || !/^[0-9a-f-]{36}$/i.test(id)) return bad(c, 'INVALID_BODY', 'Choose an outcome.');
  const registry = Registry.getInstance();
  if (!(await registry.conversationArchiveUseCases.setOutcome(id, parsed.data.outcome))) return bad(c, 'NOT_FOUND', 'No such conversation.', 404);
  await registry.createAuditLogUseCase.execute({ actorId: actor(c), action: 'ASSISTANT_CONVERSATION_OUTCOME_SET', entity: 'assistant_conversation', entityId: id, previousState: null, newState: { outcome: parsed.data.outcome } });
  return ok(c, { id, outcome: parsed.data.outcome });
});

routes.post('/conversations/:id/reply', requirePermissions([PERMISSIONS.ORDERS_MANAGE]), async (c) => {
  const id = c.req.param('id') ?? '';
  const parsed = z.object({ text: z.string().min(1).max(2000) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success || !/^[0-9a-f-]{36}$/i.test(id)) return bad(c, 'INVALID_BODY', 'Write a reply.');
  const registry = Registry.getInstance();
  const out = await registry.goldieChannelUseCases.teamReply(id, parsed.data.text);
  if (!out.ok) return bad(c, out.code, out.message, out.code === 'NOT_FOUND' ? 404 : 400);
  await registry.createAuditLogUseCase.execute({ actorId: actor(c), action: 'ASSISTANT_CONVERSATION_TEAM_REPLY', entity: 'assistant_conversation', entityId: id, previousState: null, newState: { sent: out.sent, channel: out.channel } });
  return ok(c, out);
});

export default routes;
