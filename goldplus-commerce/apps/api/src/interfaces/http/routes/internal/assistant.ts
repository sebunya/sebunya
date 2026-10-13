import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { Registry } from '../../../../infrastructure/Registry';
import { INTERNAL_KEY_HEADER, isInternalCaller } from '../../middleware/floorPriceRedaction';
import { cleanTranscript } from '../../../../domain/assistant/ChatTranscript';
import { computeLifetimePoints, soonestUnspentExpiry, tierStanding } from '../../../../domain/loyalty/LoyaltyLedger';
import { PhoneCareReader } from '../../../../infrastructure/assistant/PhoneCareReader';

/**
 * Shop-assistant admission and spend ledger, for the web container only
 * (X-GoldPlus-Internal-Key, constant-time compared). Three calls per paid turn:
 * admit -> (model call) -> settle | release. Without a reservation id from
 * admit, the web layer must not call the model.
 */
const routes = new Hono();

routes.use('*', async (c, next) => {
  if (!isInternalCaller(c.req.header(INTERNAL_KEY_HEADER), process.env.INTERNAL_API_KEY)) {
    return c.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Internal callers only.' } }, 401);
  }
  await next();
});

const ok = <T>(c: Context, data: T) => c.json({ success: true, data });
const bad = (c: Context, code: string, message: string, status = 400) => c.json({ success: false, error: { code, message } }, status as 400);
const hash = z.string().regex(/^[a-f0-9]{16,64}$/);

routes.post('/admit', async (c) => {
  const parsed = z.object({
    principalHash: hash,
    addressHash: hash.nullable().optional(),
    wantsAi: z.boolean(),
    conversationId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).nullable().optional(),
    requestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).nullable().optional(),
    continuation: z.boolean().optional(),
  }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, 'INVALID_BODY', parsed.error.issues[0]?.message ?? 'Invalid body.');
  const out = await Registry.getInstance().assistantAdmissionUseCases.admit({
    principalHash: parsed.data.principalHash, addressHash: parsed.data.addressHash ?? null,
    wantsAi: parsed.data.wantsAi, conversationId: parsed.data.conversationId ?? null,
    requestId: parsed.data.requestId ?? null, continuation: parsed.data.continuation === true,
  });
  return ok(c, out);
});

routes.post('/settle', async (c) => {
  const parsed = z.object({
    reservationId: z.string().uuid(),
    model: z.string().max(60),
    providerRequestId: z.string().max(120).nullable().optional(),
    outcome: z.string().max(40),
    usage: z.object({ inputTokens: z.number().int().min(0), outputTokens: z.number().int().min(0), cacheReadTokens: z.number().int().min(0), cacheWriteTokens: z.number().int().min(0) }),
  }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, 'INVALID_BODY', parsed.error.issues[0]?.message ?? 'Invalid body.');
  const out = await Registry.getInstance().assistantAdmissionUseCases.settle({ ...parsed.data, providerRequestId: parsed.data.providerRequestId ?? null });
  if (!out) return bad(c, 'NOT_FOUND', 'No open reservation with that id.', 404);
  return ok(c, out);
});

routes.post('/release', async (c) => {
  const parsed = z.object({ reservationId: z.string().uuid(), reason: z.string().max(200) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, 'INVALID_BODY', parsed.error.issues[0]?.message ?? 'Invalid body.');
  const released = await Registry.getInstance().assistantAdmissionUseCases.release(parsed.data);
  return ok(c, { released });
});

// ---- Goldie beyond the answer (shopper context, Customer DNA, chats by email). The web container resolves
// the session and cookies; user ids arrive only from it, behind the internal key, never from a browser.
const shopper = z.object({
  visitToken: z.string().max(600).nullable().optional(),
  userId: z.string().uuid().nullable().optional(),
  fpClientId: z.string().max(255).nullable().optional(),
});

async function shopperKey(input: z.infer<typeof shopper>) {
  let profileId: string | null = null;
  if (input.visitToken) {
    try { profileId = (await Registry.getInstance().resolveExperienceProfileUseCase.execute(input.visitToken, 'read'))?.id ?? null; } catch { profileId = null; }
  }
  return { profileId, userId: input.userId ?? null, fpClientId: input.fpClientId ?? null };
}

routes.post('/context', async (c) => {
  const parsed = shopper.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, 'INVALID_BODY', parsed.error.issues[0]?.message ?? 'Invalid body.');
  return ok(c, await Registry.getInstance().assistantConversationUseCases.context(await shopperKey(parsed.data)));
});

routes.post('/interest', async (c) => {
  const parsed = shopper.extend({
    intent: z.string().max(20), topic: z.string().min(1).max(200), phoneModel: z.string().max(80).nullable().optional(), page: z.string().max(500).nullable().optional(),
  }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, 'INVALID_BODY', parsed.error.issues[0]?.message ?? 'Invalid body.');
  const { intent, topic, phoneModel, page, ...who } = parsed.data;
  const recorded = await Registry.getInstance().assistantConversationUseCases.recordInterest(await shopperKey(who), { intent, topic, phoneModel: phoneModel ?? null, page: page ?? null });
  return ok(c, { recorded });
});

routes.post('/handover', async (c) => {
  const parsed = z.object({
    userId: z.string().uuid().nullable().optional(),
    name: z.string().max(120).nullable().optional(), phone: z.string().max(40).nullable().optional(), email: z.string().max(200).nullable().optional(),
    note: z.string().max(800).nullable().optional(), page: z.string().max(500).nullable().optional(), sendCopy: z.boolean().optional(),
    conversationId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).nullable().optional(),
    turns: z.array(z.unknown()).max(60),
  }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, 'INVALID_BODY', parsed.error.issues[0]?.message ?? 'Invalid body.');
  const clean = cleanTranscript(parsed.data.turns);
  if (!clean) return bad(c, 'INVALID_BODY', 'There is no conversation to pass on yet.');
  const out = await Registry.getInstance().assistantConversationUseCases.handOver({ ...parsed.data, userId: parsed.data.userId ?? null, turns: clean });
  if (out.ok && parsed.data.conversationId) {
    await Registry.getInstance().conversationArchiveUseCases.markHandover('web', parsed.data.conversationId, {
      ticketId: out.ticketId, customerId: parsed.data.userId ?? null, contact: { name: parsed.data.name ?? null, phone: parsed.data.phone ?? null, email: parsed.data.email ?? null },
    }).catch(() => undefined);
  }
  return out.ok ? ok(c, out) : bad(c, out.code, out.message);
});

routes.post('/transcript', async (c) => {
  const parsed = z.object({
    email: z.string().max(200), firstName: z.string().max(80).nullable().optional(),
    requestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/), turns: z.array(z.unknown()).max(60),
  }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, 'INVALID_BODY', parsed.error.issues[0]?.message ?? 'Invalid body.');
  const clean = cleanTranscript(parsed.data.turns);
  if (!clean) return bad(c, 'INVALID_BODY', 'There is no conversation to send yet.');
  const out = await Registry.getInstance().assistantConversationUseCases.emailTranscript({ email: parsed.data.email, firstName: parsed.data.firstName ?? null, turns: clean, key: parsed.data.requestId });
  return out.ok ? ok(c, out) : bad(c, out.code, out.message, out.code === 'DAILY_CAP' ? 429 : 400);
});

// ---- the conversation archive (0177): the web chat files each turn here; WhatsApp is filed by the API itself.
routes.post('/log', async (c) => {
  const parsed = z.object({
    conversationId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
    userId: z.string().uuid().nullable().optional(),
    page: z.string().max(500).nullable().optional(),
    customer: z.string().min(1).max(4000),
    goldie: z.string().max(8000).nullable().optional(),
    intent: z.string().max(20).nullable().optional(),
    mood: z.string().max(12).nullable().optional(),
    route: z.string().max(16).nullable().optional(),
  }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, 'INVALID_BODY', parsed.error.issues[0]?.message ?? 'Invalid body.');
  const d = parsed.data;
  const out = await Registry.getInstance().conversationArchiveUseCases.logTurn({
    channel: 'web', channelKey: d.conversationId, customerId: d.userId ?? null, page: d.page ?? null,
    customer: { content: d.customer }, goldie: d.goldie ? { content: d.goldie, route: d.route ?? null } : null, intent: d.intent ?? null, mood: d.mood ?? null,
  });
  return ok(c, { conversationId: out.conversationId });
});

// ---- WhatsApp care: the sender's number is verified by Meta, so it proves THEIR orders and (as an account's
// verified phone) their points. Called only by the web brain for a WhatsApp turn the API itself started.
const phoneCare = new PhoneCareReader();
routes.post('/care-by-phone', async (c) => {
  const parsed = z.object({ phone: z.string().regex(/^\d{9,15}$/) }).safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return bad(c, 'INVALID_BODY', 'Send the verified phone in international digits.');
  const registry = Registry.getInstance();
  const [orders, userId] = await Promise.all([phoneCare.recentOrders(parsed.data.phone), phoneCare.verifiedUserId(parsed.data.phone)]);
  let loyalty: Record<string, unknown> | null = null;
  if (userId) {
    const [history, tiers, reductionsFrom, pending, config] = await Promise.all([
      registry.getLoyaltyHistoryUseCase.execute({ userId }), registry.loyaltyTierRepo.activeTiers().catch(() => []), registry.loyaltyRepo.lifetimeReductionsFrom().catch(() => null),
      registry.loyaltyCompletionRepo.pendingEarnOrders(userId), registry.loyaltyRepo.getConfig(),
    ]);
    const soonest = soonestUnspentExpiry(history.entries, new Date());
    loyalty = {
      programmeActive: history.programmeActive, balance: history.balance,
      pendingPoints: pending.reduce((sum, o) => sum + Math.floor(o.totalUgx / 1000) * config.earnRatePer1000Ugx, 0),
      tier: tiers.length ? tierStanding(computeLifetimePoints(history.entries, reductionsFrom), tiers) : null,
      soonestExpiry: soonest ? soonest.toISOString() : null,
    };
  }
  return ok(c, { orders, loyalty, hasAccount: !!userId });
});

export default routes;
