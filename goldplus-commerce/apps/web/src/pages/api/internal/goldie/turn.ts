import type { APIRoute } from 'astro';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readBodyCapped } from '../../../../lib/boundedBody';
import { assistantEnabled, validateTurns } from '../../../../lib/assistant';
import { SITE_ORIGIN } from '../../../../lib/sitemap';
import { prepareTurn } from '../../../../lib/goldieTurn';
import type { ProductCard } from '../../../../lib/assistantRouter';

/**
 * POST /api/internal/goldie/turn: one Goldie turn for a messaging channel
 * (WhatsApp today), asked by the API container over the internal network with
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
  const phone = typeof b?.verifiedPhone === 'string' && /^\d{8,15}$/.test(b.verifiedPhone) ? b.verifiedPhone : null;
  const turns = validateTurns(b?.turns);
  if (!b || b.channel !== 'whatsapp' || !phone || !turns) return json({ success: false, error: { code: 'INVALID_BODY', message: 'channel, verifiedPhone and turns are required.' } }, 400);

  const principal = createHash('sha256').update(`assistant:wa:${phone}`).digest('hex');
  const requestId = createHash('sha256').update(`${phone}:${turns.length}:${turns[turns.length - 1]!.content}`).digest('hex').slice(0, 32);
  const prepared = await prepareTurn({
    channel: 'whatsapp', turns, requestId, page: null, principalHash: principal, addressHash: null,
    who: { visitToken: null, userId: null, fpClientId: null, verifiedPhone: phone },
    care: { bearer: null, clientAddress: null, site: SITE_ORIGIN, verifiedPhone: phone, channel: 'whatsapp', conversationKey: typeof b.conversationKey === 'string' ? b.conversationKey.slice(0, 128) : null, customerName: typeof b.name === 'string' ? b.name.slice(0, 80) : null },
    apiKey: String(process.env.ANTHROPIC_API_KEY),
  });
  if (prepared.kind === 'refused') {
    // A busy or rate-limited moment still gets a human answer on WhatsApp, never silence.
    const text = prepared.code === 'RATE_LIMITED' || prepared.code === 'BUSY'
      ? "Give me a moment, I'm with a few customers. Send your question again in a minute, or wait and the team will reply here."
      : prepared.code === 'DUPLICATE' ? '' : 'The team will reply to you here shortly.';
    return json({ success: true, data: { text, products: [], links: [], intent: 'UNKNOWN', mood: 'neutral', route: 'deterministic' } });
  }
  let text = ''; let products: ProductCard[] = []; let links: Array<{ label: string; url: string }> = [];
  for await (const ev of prepared.run()) {
    if (ev.type === 'text') text += ev.text;
    else if (ev.type === 'products') products = [...products, ...ev.items];
    else if (ev.type === 'links') links = [...links, ...ev.items];
    else if (ev.type === 'error' && !text) text = 'Sorry, I could not finish that one. The team will reply to you here shortly.';
  }
  return json({ success: true, data: { text, products, links, intent: prepared.meta.intent, mood: prepared.meta.mood.mood, route: prepared.meta.route } });
};

export const GET: APIRoute = () => notFound();
