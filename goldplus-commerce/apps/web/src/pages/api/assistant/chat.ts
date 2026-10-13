import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { readBodyCapped } from '../../../lib/boundedBody';
import { visitorKey } from '../../../lib/publicFormLimiter';
import { isSignedVisitToken } from '../../../lib/visitToken';
import { assistantEnabled, validateTurns } from '../../../lib/assistant';
import { SITE_ORIGIN } from '../../../lib/sitemap';
import { requestUserId } from '../../../lib/customerAuth';
import { readSessionToken } from '../../../lib/session';
import { addressHash, principalHash } from '../../../lib/assistantAdmission';
import { logTurn, type ShopperIdentity } from '../../../lib/assistantConversation';
import { prepareTurn, resetTurnState } from '../../../lib/goldieTurn';

/**
 * POST /api/assistant/chat: Goldie on the website, same origin only.
 * Body: { messages: [{ role, content }, ...] ending with the customer's turn }.
 * Header X-Assistant-Request-Id: one id per send; a retry reuses it and is
 * answered once: this replica remembers ids for two minutes, and the API's
 * shared counter refuses a second arrival on any other replica.
 * Header X-Goldie-Conversation: the browser's id for this conversation; each
 * turn is filed under it in the conversation archive (0177) for the team.
 * Reply: text/event-stream of `data: <event JSON>` frames.
 *
 * The turn itself (listen, route, answer) is lib/goldieTurn.ts, shared with
 * WhatsApp. This file is the website's door: validation, who is asking, the
 * stream, and filing the turn.
 */
export const prerender = false;

/** The signed first-party visit cookie the middleware issues (middleware.ts VISIT_COOKIE_NAME); read only, never set here. */
const VISIT_COOKIE_NAME = 'gp_visit';
/** The first-party analytics id (middleware); the key consent and zero-party signals are filed under. */
const FP_COOKIE_NAME = '_fp_cid';

const MAX_BODY_BYTES = 32 * 1024;
const IDEMPOTENCY_TTL_MS = 2 * 60_000;
const recentRequestIds = new Map<string, number>();

/** Test seam. */
export function resetAssistantState(): void { recentRequestIds.clear(); resetTurnState(); }

const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });

const seenRecently = (id: string | null): boolean => {
  const now = Date.now();
  if (recentRequestIds.size > 10_000) recentRequestIds.clear();
  for (const [k, t] of recentRequestIds) if (now - t > IDEMPOTENCY_TTL_MS) recentRequestIds.delete(k);
  if (!id) return false;
  if (recentRequestIds.has(id)) return true;
  recentRequestIds.set(id, now);
  return false;
};

/** The page the question was asked on, as a same-site path. */
const pagePath = (request: Request): string | null => {
  try { const u = new URL(request.headers.get('referer') ?? ''); return u.origin === new URL(request.url).origin ? u.pathname.slice(0, 300) : null; } catch { return null; }
};

export const POST: APIRoute = async ({ request, clientAddress, cookies, locals }) => {
  if (!assistantEnabled()) return json({ success: false, error: { code: 'DISABLED', message: 'The assistant is not switched on.' } }, 503);
  const read = await readBodyCapped(request, MAX_BODY_BYTES);
  if (!read.ok) return json({ success: false, error: { code: 'TOO_LARGE', message: 'That message is too long.' } }, 413);
  let raw: unknown = null;
  try { raw = JSON.parse(read.text); } catch { raw = null; }
  const turns = validateTurns((raw as { messages?: unknown } | null)?.messages);
  if (!turns) return json({ success: false, error: { code: 'INVALID_BODY', message: 'Send the conversation as messages ending with your question.' } }, 400);
  const requestId = (request.headers.get('x-assistant-request-id') ?? '').trim().slice(0, 64) || null;
  if (requestId && !/^[A-Za-z0-9_-]{8,64}$/.test(requestId)) return json({ success: false, error: { code: 'INVALID_REQUEST_ID', message: 'Bad request id.' } }, 400);
  if (seenRecently(requestId)) return json({ success: false, error: { code: 'DUPLICATE', message: 'That question is already being answered.' } }, 409);
  const conversationId = (request.headers.get('x-goldie-conversation') ?? '').trim();
  const archiveKey = /^[A-Za-z0-9_-]{8,64}$/.test(conversationId) ? conversationId : null;

  // Who is asking: the signed-in customer (the middleware resolves the session for pages only, not /api/*, so ask
  // here; a guest without a session cookie costs nothing), else the signed visit cookie, else the address.
  const address = visitorKey(request.headers, () => clientAddress);
  const visit = cookies.get(VISIT_COOKIE_NAME)?.value;
  const userId = await requestUserId(locals as { gpUserId?: string | null }, cookies).catch(() => null);
  const fp = cookies.get(FP_COOKIE_NAME)?.value ?? '';
  const who: ShopperIdentity = { visitToken: isSignedVisitToken(visit) ? visit! : null, userId, fpClientId: /^[A-Za-z0-9._-]{8,200}$/.test(fp) ? fp : null };
  const page = pagePath(request);

  const prepared = await prepareTurn({
    channel: 'web', turns, requestId, page,
    principalHash: principalHash({ userId, visitToken: who.visitToken, address }), addressHash: addressHash(address), who,
    care: { bearer: userId ? readSessionToken(request) : null, clientAddress: address === 'unknown' ? null : address, site: SITE_ORIGIN, channel: 'web', conversationKey: archiveKey },
    apiKey: String(process.env.ANTHROPIC_API_KEY), signal: request.signal,
  });
  if (prepared.kind === 'refused') {
    return json({ success: false, error: { code: prepared.code, message: prepared.message } }, prepared.status, prepared.retryAfter ? { 'Retry-After': prepared.retryAfter } : {});
  }

  const encoder = new TextEncoder();
  const last = turns[turns.length - 1]!.content;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      let answer = '';
      try {
        for await (const ev of prepared.run()) {
          if (ev.type === 'meta') continue; // operational, not for the browser
          if (ev.type === 'text') answer += ev.text;
          send(ev);
        }
      } catch (e) {
        console.error('[assistant] unexpected', e instanceof Error ? e.message : e);
        send({ type: 'error', code: 'FAILED', message: 'Something went wrong. Please ask again.', billed: false });
      } finally {
        controller.close();
        // Filed after the answer, off the customer's path: the archive never slows a reply.
        if (archiveKey) logTurn({ conversationId: archiveKey, userId, page, customer: last, goldie: answer || null, intent: prepared.meta.intent, mood: prepared.meta.mood.mood, route: prepared.meta.route });
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'X-Robots-Tag': 'noindex',
      // Operational, never personal: which path answered and which tier the visitor is in.
      'X-Assistant-Route': prepared.meta.route, 'X-Assistant-Tier': prepared.meta.tier, 'X-Assistant-Request-Id': requestId ?? randomUUID(),
    },
  });
};

const notAllowed: APIRoute = () => json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST a conversation to this address.' } }, 405, { Allow: 'POST' });
export const GET = notAllowed;
