import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { Registry } from '../../../../infrastructure/Registry';
import { INTERNAL_KEY_HEADER, isInternalCaller } from '../../middleware/floorPriceRedaction';

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

export default routes;
