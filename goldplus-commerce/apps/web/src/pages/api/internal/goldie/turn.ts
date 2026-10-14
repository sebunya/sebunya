import type { APIRoute } from 'astro';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readBodyCapped } from '../../../../lib/boundedBody';
import { assistantEnabled, validateTurns } from '../../../../lib/assistant';
import { SITE_ORIGIN } from '../../../../lib/sitemap';
import { prepareTurn } from '../../../../lib/goldieTurn';
import type { ProductCard } from '../../../../lib/assistantRouter';

/**
 * POST /api/internal/goldie/turn: one Goldie turn for a messaging channel
 * (WhatsApp, Messenger, Instagram), asked by the API container over the internal network with
 * the internal key. The API has already verified Meta's signature and filed
 * the customer's message; this runs the same brain as the website and returns
 * the answer as JSON for the API to send and file.
 *
 * The sender's number arrives verified by Meta (via the API), so it is the
 * customer's proof for their own orders and points (CareContext.verifiedPhone).
 * Nothing here is reachable from a browser: without the key it is a 404.
 */
export const prerender = false;

const notFound = () => new Response('Not found', { status: 404 });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

function internalCaller(header: string | null): boolean {
  const expected = process.env.INTERNAL_API_KEY ?? '';
  if (expected.length < 32 || !header) return false;
  const a = createHash('sha256').update(header).digest(), b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export const POST: APIRoute = async ({ request }) => {
  if (!internalCaller(request.headers.get('x-goldplus-internal-key'))) return notFound();
  if (!assistantEnabled()) return json({ success: false, error: { code: 'DISABLED', message: 'Goldie is not switched on.' } }, 503);
  const read = await readBodyCapped(request, 64 * 1024);
  if (!read.ok) return json({ success: false, error: { code: 'TOO_LARGE', message: 'Too long.' } }, 413);
  let b: Record<string, unknown> | null = null;
  try { b = JSON.parse(read.text); } catch { b = null; }
  const turns = validateTurns(b?.turns);
  const social = b?.channel === 'messenger' || b?.channel === 'instagram' ? b.channel as 'messenger' | 'instagram' : null;
  const senderId = social && typeof b?.senderId === 'string' && /^\d{5,30}$/.test(b.senderId) ? b.senderId : null;
  const phone = !social && typeof b?.verifiedPhone === 'string' && /^\d{8,15}$/.test(b.verifiedPhone) ? b.verifiedPhone : null;
  if (!b || !turns || (social ? !senderId : b.channel !== 'whatsapp' || !phone)) return json({ success: false, error: { code: 'INVALID_BODY', message: 'channel, turns and verifiedPhone (WhatsApp) or senderId (Messenger, Instagram) are required.' } }, 400);

  // Messenger and Instagram carry no phone: the sender id is only a fairness bucket, never proof of anything.
  const who = social ? `${social}:${senderId}` : `wa:${phone}`;
  const principal = createHash('sha256').update(`assistant:${who}`).digest('hex');
  // The whole conversation, not its length and last line: once the history window is full, the length stays the
  // same, and a customer who says "ok" twice would be taken for a duplicate (no reply, a needless task).
  const requestId = createHash('sha256').update(`${who}:${JSON.stringify(turns)}`).digest('hex').slice(0, 32);
  const channel = social ?? 'whatsapp';
  const prepared = await prepareTurn({
    channel, turns, requestId, page: null, principalHash: principal, addressHash: null,
    who: { visitToken: null, userId: null, fpClientId: null, verifiedPhone: phone },
    care: { bearer: null, clientAddress: null, site: SITE_ORIGIN, verifiedPhone: phone, channel, conversationKey: typeof b.conversationKey === 'string' ? b.conversationKey.slice(0, 128) : null, customerName: typeof b.name === 'string' ? b.name.slice(0, 80) : null },
    apiKey: String(process.env.ANTHROPIC_API_KEY),
  });
  if (prepared.kind === 'refused') {
    // A busy or rate-limited moment still gets a human answer on the channel, never silence.
    const text = prepared.code === 'RATE_LIMITED' || prepared.code === 'BUSY'
      ? "Give me a moment, I'm with a few customers. Send your question again in a minute, or wait and the team will reply here."
      : prepared.code === 'DUPLICATE' ? '' : 'The team will reply to you here shortly.';
    return json({ success: true, data: { text, products: [], links: [], intent: 'UNKNOWN', mood: 'neutral', route: 'deterministic' } });
  }
  // WhatsApp gets one message, so only the answer after the last tool call is sent; words written before a tool call
  // ("I'll pull the list again…") are thinking aloud and were glued to the answer ("more.You were right").
  let text = ''; let before = ''; let products: ProductCard[] = []; let links: Array<{ label: string; url: string }> = [];
  for await (const ev of prepared.run()) {
    if (ev.type === 'text') text += ev.text;
    else if (ev.type === 'tool') { if (text.trim()) before = `${before} ${text}`.trim(); text = ''; }
    else if (ev.type === 'products') products = [...products, ...ev.items];
    else if (ev.type === 'links') links = [...links, ...ev.items];
    else if (ev.type === 'error' && !text) text = 'Sorry, I could not finish that one. The team will reply to you here shortly.';
  }
  text = text.trim() || before;
  return json({ success: true, data: { text, products, links, intent: prepared.meta.intent, mood: prepared.meta.mood.mood, route: prepared.meta.route, cacheId: prepared.meta.cacheId ?? null } });
};

export const GET: APIRoute = () => notFound();
