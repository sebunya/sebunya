import type { APIRoute } from 'astro';
import { randomUUID } from 'node:crypto';
import { readBodyCapped } from '../../../lib/boundedBody';
import { visitorKey } from '../../../lib/publicFormLimiter';
import { isSignedVisitToken } from '../../../lib/visitToken';
import { assistantEnabled, runAssistant, validateTurns, type AssistantEvent } from '../../../lib/assistant';
import { SOFT_LIMIT_TEXT, answerDeterministically, classify, type DeterministicAnswer } from '../../../lib/assistantRouter';
import { addressHash, admit, principalHash, release, settle, type AdmitOutput } from '../../../lib/assistantAdmission';

/**
 * POST /api/assistant/chat — the shop assistant, same origin only.
 * Body: { messages: [{ role, content }, …] ending with the customer's turn }.
 * Header X-Assistant-Request-Id: one id per send; a retry reuses it and is
 * answered once (idempotent within this replica for two minutes).
 * Reply: text/event-stream of `data: <AssistantEvent JSON>` frames.
 *
 * Order of operations (mandate §5A): validate -> classify -> admission
 * (fairness tier, abuse ceilings, month ledger) -> deterministic answer, or a
 * paid turn against a reservation that is settled or released afterwards.
 * Nothing is stored: the browser keeps its own transcript for the session.
 */
export const prerender = false;

/** The signed first-party visit cookie the middleware issues (middleware.ts VISIT_COOKIE_NAME); read only, never set here. */
const VISIT_COOKIE_NAME = 'gp_visit';

const MAX_BODY_BYTES = 32 * 1024;
const MAX_CONCURRENT = 8;
const IDEMPOTENCY_TTL_MS = 2 * 60_000;
const recentRequestIds = new Map<string, number>();
let inFlight = 0;

/** Test seam. */
export function resetAssistantState(): void { recentRequestIds.clear(); inFlight = 0; }

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

const fallbackAnswer = async (classified: ReturnType<typeof classify>): Promise<DeterministicAnswer> => {
  // Paid AI is not available for this turn: a product lookup still runs, and the honest sentence leads.
  const base = classified.intent === 'PRODUCT' || classified.intent === 'UNKNOWN'
    ? await answerDeterministically({ ...classified, intent: 'PRODUCT', deterministic: true }).catch(() => null)
    : null;
  const products = base?.products ?? [];
  return { intent: classified.intent, text: products.length ? `${SOFT_LIMIT_TEXT} Here is what matched in the catalogue:` : SOFT_LIMIT_TEXT, products, links: base?.links ?? [] };
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

  // Who is asking, as a one-way pseudonym: the signed-in customer, else the signed first-party visit cookie, else the address.
  const address = visitorKey(request.headers, () => clientAddress);
  const visit = cookies.get(VISIT_COOKIE_NAME)?.value;
  const principal = principalHash({ userId: (locals as { gpUserId?: string | null }).gpUserId ?? null, visitToken: isSignedVisitToken(visit) ? visit : null, address });
  const conversationId = requestId;

  const last = turns[turns.length - 1]!.content;
  const classified = classify(last);
  const wantsAi = !classified.deterministic;
  const admission: AdmitOutput = (await admit({ principalHash: principal, addressHash: addressHash(address), wantsAi, conversationId })) ?? {
    // The admission authority could not be reached: fail closed for money, open for deterministic help.
    decision: wantsAi ? 'GLOBAL_BUDGET_FALLBACK' : 'ALLOW_DETERMINISTIC', tier: 'welcome', reason: 'admission unreachable', reservationId: null,
    model: '', effort: 'low', maxOutputTokens: 0, maxToolRounds: 0, degraded: true,
  };
  if (admission.decision === 'DISABLED') return json({ success: false, error: { code: 'DISABLED', message: 'The assistant is switched off for now.' } }, 503);
  if (admission.decision === 'DENY_EXPENSIVE') {
    const retry = String(admission.retryAfterSeconds ?? 60);
    return json({ success: false, error: { code: 'RATE_LIMITED', message: 'Please wait a moment before asking more.' } }, 429, { 'Retry-After': retry });
  }

  const encoder = new TextEncoder();
  const route = admission.decision === 'ALLOW_AI' ? 'ai' : wantsAi ? 'fallback' : 'deterministic';
  if (route === 'ai' && inFlight >= MAX_CONCURRENT) {
    if (admission.reservationId) void release({ reservationId: admission.reservationId, reason: 'replica concurrency cap' });
    return json({ success: false, error: { code: 'BUSY', message: 'The assistant is busy right now. Please try again in a minute.' } }, 503, { 'Retry-After': '30' });
  }
  if (route === 'ai') inFlight += 1;
  const apiKey = String(process.env.ANTHROPIC_API_KEY);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: AssistantEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      const sendAnswer = (a: DeterministicAnswer) => {
        send({ type: 'text', text: a.text });
        if (a.products.length) send({ type: 'products', items: a.products });
        if (a.links.length) send({ type: 'text', text: '\n' + a.links.map((l) => `${l.label}: ${l.url}`).join('\n') });
        send({ type: 'done', usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, providerRequestId: null, outcome: 'ANSWERED' });
      };
      try {
        if (route === 'deterministic') {
          sendAnswer(await answerDeterministically(classified));
        } else if (route === 'fallback') {
          sendAnswer(await fallbackAnswer(classified));
        } else {
          const reservationId = admission.reservationId!;
          let settled = false;
          for await (const ev of runAssistant(turns, { apiKey, model: admission.model, effort: admission.effort, maxOutputTokens: admission.maxOutputTokens, maxToolRounds: admission.maxToolRounds, signal: request.signal })) {
            if (ev.type === 'done') {
              settled = true;
              await settle({ reservationId, model: admission.model, providerRequestId: ev.providerRequestId, outcome: ev.outcome, usage: ev.usage });
            } else if (ev.type === 'error') {
              settled = true;
              // Not billed (refused before any output): give the money back. Billed or unknown: settle what is known; a
              // partial stream with unknown output stays reserved and becomes UNKNOWN, never zero.
              if (!ev.billed) await release({ reservationId, reason: ev.code });
              else if (ev.usage && ev.usage.outputTokens > 0) await settle({ reservationId, model: admission.model, providerRequestId: null, outcome: 'STREAM_FAILED', usage: ev.usage });
            }
            send(ev);
          }
          if (!settled) { /* client aborted mid-turn: the reservation ages into UNKNOWN and keeps counting */ }
        }
      } catch (e) {
        console.error('[assistant] unexpected', e instanceof Error ? e.message : e);
        send({ type: 'error', code: 'FAILED', message: 'Something went wrong. Please ask again.', billed: false });
      } finally {
        if (route === 'ai') inFlight = Math.max(0, inFlight - 1);
        controller.close();
      }
    },
    cancel() { if (route === 'ai') inFlight = Math.max(0, inFlight - 1); },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'X-Robots-Tag': 'noindex',
      // Operational, never personal: which path answered and which tier the visitor is in.
      'X-Assistant-Route': route, 'X-Assistant-Tier': admission.tier, 'X-Assistant-Request-Id': requestId ?? randomUUID(),
    },
  });
};

const notAllowed: APIRoute = () => json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST a conversation to this address.' } }, 405, { Allow: 'POST' });
export const GET = notAllowed;
