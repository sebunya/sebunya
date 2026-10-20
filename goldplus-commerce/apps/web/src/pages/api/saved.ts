import type { APIRoute } from 'astro';
import { apiBase } from '../../lib/api';
import { readSessionToken } from '../../lib/session';
import { readBodyCapped } from '../../lib/boundedBody';

/**
 * "Save for later" form posts (gap analysis #6). Signed-in: saves or removes through the account API and comes
 * back. Signed out: goes to sign-in and returns to the product, where the shopper presses Save again (nothing is
 * kept for a guest, so nothing is stored about them). Cross-site posts are refused by the middleware.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const safeBack = (v: string) => (/^\/(products\/[a-z0-9-]+|account\/saved)$/i.test(v) ? v : '/account/saved');

export const POST: APIRoute = async ({ request, redirect }) => {
  const read = await readBodyCapped(request, 2048);
  if (!read.ok) return new Response(null, { status: 413 });
  const f = new URLSearchParams(read.text);
  const productId = f.get('productId') ?? '';
  const op = f.get('op') === 'remove' ? 'remove' : 'add';
  const back = safeBack(f.get('back') ?? '');
  const token = readSessionToken(request);
  if (!token) return redirect(`/login?returnTo=${encodeURIComponent(back)}`, 303);
  if (UUID.test(productId)) {
    await fetch(op === 'add' ? `${apiBase}/account/saved` : `${apiBase}/account/saved/${productId}`, {
      method: op === 'add' ? 'POST' : 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: op === 'add' ? JSON.stringify({ productId }) : undefined,
      signal: AbortSignal.timeout(4000),
    }).catch(() => null);
  }
  return redirect(back.startsWith('/products/') ? `${back}#save` : back, 303);
};
