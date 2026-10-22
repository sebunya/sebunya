import type { APIRoute } from 'astro';
import { apiBase } from '../../../lib/api';
import { readBodyCapped } from '../../../lib/boundedBody';
import { apiHeaders, readClientAddress } from '../../../lib/forwardClient';

/**
 * Same-origin relay for "Was this helpful?" (gap analysis #10). Forwards only the review id and the vote, with the
 * visitor's own signed visit token so the API can count one vote per visitor. Works without JavaScript (a form post
 * that comes back to the product's reviews) and with it (JSON). Cross-site posts are refused by the middleware.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const POST: APIRoute = async (context) => {
  const { request, locals, redirect } = context;
  const read = await readBodyCapped(request, 2048);
  if (!read.ok) return new Response(null, { status: 413 });
  const isJson = (request.headers.get('content-type') ?? '').includes('application/json');
  let reviewId = '';
  let vote = '';
  let back = '';
  if (isJson) {
    try { const b = JSON.parse(read.text); reviewId = String(b?.reviewId ?? ''); vote = String(b?.vote ?? ''); } catch { /* invalid below */ }
  } else {
    const f = new URLSearchParams(read.text);
    reviewId = f.get('reviewId') ?? ''; vote = f.get('vote') ?? ''; back = f.get('back') ?? '';
  }
  const visit = (locals as { gpVisit?: string }).gpVisit ?? '';
  let ok = false;
  if (UUID.test(reviewId) && (vote === 'helpful' || vote === 'not_helpful') && visit) {
    const res = await fetch(`${apiBase}/commerce/reviews/${reviewId}/vote`, {
      method: 'POST',
      // Attributed to the visitor, so the API's per-client limit applies (a relay without it counted as internal).
      headers: apiHeaders({ 'Content-Type': 'application/json', 'x-gp-visit': visit }, readClientAddress(context)),
      body: JSON.stringify({ vote }),
      signal: AbortSignal.timeout(3000),
    }).catch(() => null);
    ok = Boolean(res?.ok);
  }
  if (!isJson) return redirect(/^\/products\/[a-z0-9-]+$/i.test(back) ? `${back}#reviews` : '/', 303);
  return new Response(JSON.stringify({ success: ok }), { status: ok ? 200 : 400, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
};
