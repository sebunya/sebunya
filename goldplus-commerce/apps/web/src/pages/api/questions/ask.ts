import type { APIRoute } from 'astro';
import { apiBase } from '../../../lib/api';
import { readBodyCapped } from '../../../lib/boundedBody';
import { apiHeaders, readClientAddress } from '../../../lib/forwardClient';

/**
 * Same-origin relay for "Ask a question" on a product page (0208). Forwards only the product id, the name, the
 * question and an optional phone or email, with the visitor's own signed visit token so the API can count a few
 * questions a day per visitor. Works without JavaScript (a form post that comes back to the product's questions)
 * and with it (JSON). Cross-site posts are refused by the middleware.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FIELDS = ['productId', 'name', 'question', 'phone', 'email'] as const;
// `phone` is the page's "phone or email" box: room for an email until it is split below (the API checks a phone's shape).
const MAX: Record<(typeof FIELDS)[number], number> = { productId: 36, name: 80, question: 600, phone: 254, email: 254 };

export const POST: APIRoute = async (context) => {
  const { request, locals, redirect } = context;
  const read = await readBodyCapped(request, 4096);
  if (!read.ok) return new Response(null, { status: 413 });
  const isJson = (request.headers.get('content-type') ?? '').includes('application/json');
  let raw: Record<string, unknown> = {};
  let back = '';
  if (isJson) {
    try { raw = JSON.parse(read.text) ?? {}; } catch { raw = {}; }
  } else {
    const f = new URLSearchParams(read.text);
    for (const k of FIELDS) raw[k] = f.get(k) ?? '';
    back = f.get('back') ?? '';
  }
  const body: Record<string, string> = {};
  for (const k of FIELDS) { const v = raw[k]; body[k] = typeof v === 'string' ? v.trim().slice(0, MAX[k]) : ''; }
  // The page has one "phone or email" box (name="phone"). Its script split the two; a post without JavaScript sent
  // an email as the phone, which the API refused as an unreadable number and the question was lost (2026-10-29).
  if (body.phone.includes('@') && !body.email) { body.email = body.phone.slice(0, MAX.email); body.phone = ''; }
  const visit = (locals as { gpVisit?: string }).gpVisit ?? '';
  let upstream: Response | null = null;
  if (UUID.test(body.productId) && visit) {
    upstream = await fetch(`${apiBase}/commerce/questions`, {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json', 'x-gp-visit': visit }, readClientAddress(context)),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(6000),
    }).catch(() => null);
  }
  const backPath = /^\/products\/[a-z0-9-]+$/i.test(back) ? back : '/';
  if (!isJson) {
    // Without JavaScript the page says why, from the API's own refusal code (the page words it).
    let why = '';
    if (upstream && !upstream.ok) {
      const code = ((await upstream.json().catch(() => null)) as { error?: { code?: unknown } } | null)?.error?.code;
      why = typeof code === 'string' && /^[A-Z_]{2,30}$/.test(code) ? `&why=${code}` : '';
    } else if (!upstream) why = visit ? '&why=UNAVAILABLE' : '&why=NO_VISITOR';
    return redirect(`${backPath}?asked=${upstream?.ok ? '1' : '0'}${why}#questions`, 303);
  }
  if (!upstream) {
    // No visit cookie is "refresh"; an API that did not answer is not the shopper's to fix.
    const [status, code, message] = visit ? [502, 'UNAVAILABLE', 'We could not take your question just now. Try again in a minute, or ask us on WhatsApp.'] : [400, 'NO_VISITOR', 'Refresh the page and try again.'];
    return new Response(JSON.stringify({ success: false, error: { code, message } }), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
  return new Response(await upstream.text(), { status: upstream.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
};
