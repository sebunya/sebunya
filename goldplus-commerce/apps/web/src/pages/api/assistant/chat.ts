import type { APIRoute } from 'astro';
import { readBodyCapped } from '../../../lib/boundedBody';
import { visitorKey } from '../../../lib/publicFormLimiter';
import { assistantEnabled, runAssistant, validateTurns, type AssistantEvent } from '../../../lib/assistant';

/**
 * POST /api/assistant/chat — the shop assistant, same origin only.
 * Body: { messages: [{ role: 'user' | 'assistant', content: string }, …] } ending with the customer's turn.
 * Reply: text/event-stream of `data: <AssistantEvent JSON>` frames, ending with done or error.
 * Nothing is stored: the browser keeps its own transcript for the session.
 */
export const prerender = false;

const MAX_BODY_BYTES = 32 * 1024;
// Per-visitor budget: generous for a shopper, useless for a scraper (CGNAT puts many people behind one address).
const WINDOW_MS = 10 * 60_000;
const MAX_PER_WINDOW = 30;
// A cap on simultaneous upstream streams, so one busy hour cannot run up the bill.
const MAX_CONCURRENT = 8;
const visitors = new Map<string, { start: number; n: number }>();
let inFlight = 0;

export function allowVisitor(key: string, now = Date.now()): boolean {
  const cur = visitors.get(key);
  if (!cur || now - cur.start > WINDOW_MS) {
    if (visitors.size > 20_000) visitors.clear();
    visitors.set(key, { start: now, n: 1 });
    return true;
  }
  cur.n += 1;
  return cur.n <= MAX_PER_WINDOW;
}

/** Test seam: forget every visitor's budget. */
export function resetAssistantBudgets(): void { visitors.clear(); inFlight = 0; }

const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });

export const POST: APIRoute = async ({ request, clientAddress }) => {
  if (!assistantEnabled()) return json({ success: false, error: { code: 'DISABLED', message: 'The assistant is not switched on.' } }, 503);
  const visitor = visitorKey(request.headers, () => clientAddress);
  if (!allowVisitor(visitor)) return json({ success: false, error: { code: 'RATE_LIMITED', message: 'Please wait a few minutes before asking more.' } }, 429, { 'Retry-After': '600' });
  const read = await readBodyCapped(request, MAX_BODY_BYTES);
  if (!read.ok) return json({ success: false, error: { code: 'TOO_LARGE', message: 'That message is too long.' } }, 413);
  let raw: unknown = null;
  try { raw = JSON.parse(read.text); } catch { raw = null; }
  const turns = validateTurns((raw as { messages?: unknown } | null)?.messages);
  if (!turns) return json({ success: false, error: { code: 'INVALID_BODY', message: 'Send the conversation as messages ending with your question.' } }, 400);
  if (inFlight >= MAX_CONCURRENT) return json({ success: false, error: { code: 'BUSY', message: 'The assistant is busy right now. Please try again in a minute.' } }, 503, { 'Retry-After': '30' });

  const apiKey = String(process.env.ANTHROPIC_API_KEY);
  const model = process.env.ASSISTANT_MODEL?.trim() || undefined;
  const encoder = new TextEncoder();
  inFlight += 1;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: AssistantEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
      try {
        for await (const ev of runAssistant(turns, { apiKey, model, signal: request.signal })) send(ev);
      } catch (e) {
        console.error('[assistant] unexpected', e instanceof Error ? e.message : e);
        send({ type: 'error', code: 'FAILED', message: 'Something went wrong. Please ask again.' });
      } finally {
        inFlight = Math.max(0, inFlight - 1);
        controller.close();
      }
    },
    cancel() { inFlight = Math.max(0, inFlight - 1); },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'X-Robots-Tag': 'noindex' },
  });
};

const notAllowed: APIRoute = () => json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'POST a conversation to this address.' } }, 405, { Allow: 'POST' });
export const GET = notAllowed;
