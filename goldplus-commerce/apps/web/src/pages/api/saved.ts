import type { APIRoute } from 'astro';
import { apiBase } from '../../lib/api';
import { apiHeaders, readClientAddress } from '../../lib/forwardClient';
import { readSessionToken } from '../../lib/session';
import { readBodyCapped } from '../../lib/boundedBody';
import { readGuestSaved, toggleGuestSaved, writeGuestSaved } from '../../lib/guestSaved';

/**
 * "Save for later" form posts (gap analysis #6). Signed-in: saves or removes through the account API and comes
 * back. Signed out (Baymard P3): the list is kept on the device in one cookie of product ids, nothing about the
 * person, and moved into the account at sign-in. Cross-site posts are refused by the middleware.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const safeBack = (v: string) => (/^\/(products\/[a-z0-9-]+|account\/saved)$/i.test(v) ? v : '/account/saved');

export const POST: APIRoute = async (ctx) => {
  const { request, redirect, cookies } = ctx;
  const read = await readBodyCapped(request, 2048);
  if (!read.ok) return new Response(null, { status: 413 });
  const f = new URLSearchParams(read.text);
  const productId = f.get('productId') ?? '';
  const op = f.get('op') === 'remove' ? 'remove' : 'add';
  const back = safeBack(f.get('back') ?? '');
  const token = readSessionToken(request);
  if (!token) {
    if (UUID.test(productId)) writeGuestSaved(cookies, toggleGuestSaved(readGuestSaved(cookies), productId, op), import.meta.env.PROD);
    return redirect(back.startsWith('/products/') ? `${back}#save` : back, 303);
  }
  if (UUID.test(productId)) {
    await fetch(op === 'add' ? `${apiBase}/account/saved` : `${apiBase}/account/saved/${productId}`, {
      method: op === 'add' ? 'POST' : 'DELETE',
      headers: apiHeaders({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, readClientAddress(ctx)),
      body: op === 'add' ? JSON.stringify({ productId }) : undefined,
      signal: AbortSignal.timeout(4000),
    }).catch(() => null);
  }
  return redirect(back.startsWith('/products/') ? `${back}#save` : back, 303);
};
