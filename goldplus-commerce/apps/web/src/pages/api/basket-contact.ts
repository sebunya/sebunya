import type { APIRoute } from 'astro';
import { CART_CREDENTIAL_HEADER } from '@goldplus/shared';
import { apiBase } from '../../lib/api';
import { apiHeaders, readClientAddress } from '../../lib/forwardClient';
import { readBodyCapped } from '../../lib/boundedBody';
import { cartCredentialCookieName } from '@goldplus/shared';
import { readSessionToken } from '../../lib/session';

/**
 * 0214: the beacon from the checkout page's phone field (a guest who typed a number and left). Relays the number
 * under the browser's existing guest cart credential; nothing is minted here and nothing is answered. A signed-in
 * visitor is ignored (their account number is used). Same-origin only (the middleware refuses cross-site posts).
 */
export const POST: APIRoute = async (ctx) => {
  const { request, cookies } = ctx;
  const read = await readBodyCapped(request, 1024);
  if (!read.ok) return new Response(null, { status: 413 });
  if (readSessionToken(request)) return new Response(null, { status: 204 });
  const f = new URLSearchParams(read.text);
  const phone = (f.get('phone') ?? '').trim().slice(0, 32);
  const name = (f.get('name') ?? '').trim().slice(0, 120);
  const token = cookies.get(cartCredentialCookieName(import.meta.env.PROD))?.value;
  if (!token || phone.length < 9) return new Response(null, { status: 204 });
  await fetch(`${apiBase}/commerce/cart/contact`, {
    method: 'POST',
    headers: apiHeaders({ 'Content-Type': 'application/json', [CART_CREDENTIAL_HEADER]: token }, readClientAddress(ctx)),
    body: JSON.stringify({ phone, name: name || undefined }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => null);
  return new Response(null, { status: 204 });
};
