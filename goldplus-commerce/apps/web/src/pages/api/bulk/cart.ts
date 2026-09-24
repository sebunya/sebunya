import type { APIRoute } from 'astro';
import { readBodyCapped } from '../../../lib/boundedBody';
import { cartClient, cartMessageFor, type CartView } from '../../../lib/cartClient';
import { resolveCartCredential } from '../../../lib/cartCredential';
import { requestSession } from '../../../lib/customerAuth';
import { checkRequestOrigin, CROSS_SITE_MESSAGE } from '../../../lib/requestOrigin';
import { CART_LINE_QUANTITY_CAP, CART_MAX_DISTINCT_LINES } from '../../../lib/bulkList';

/**
 * The bulk builder's "Add to basket" (docs/bulk-buying/DESIGN.md).
 *
 * Adds each line through the SAME typed cart client the basket page uses, with
 * this visitor's own signed cart credential, and reports what happened to each
 * line. The basket stays the authority: its 1-99 per product and 50-product
 * limits are its own, and a line it refuses is reported, never assumed added.
 */
const MAX_BODY_BYTES = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Outcome = { productId: string; outcome: 'added' | 'over_cap' | 'refused'; message?: string };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const origin = checkRequestOrigin(request, import.meta.env as unknown as Record<string, string | undefined>);
  if (!origin.allowed) return json(403, { success: false, error: { code: 'CROSS_SITE', message: CROSS_SITE_MESSAGE } });

  const read = await readBodyCapped(request, MAX_BODY_BYTES);
  if (!read.ok) return json(413, { success: false, error: { code: 'TOO_LARGE', message: 'That list is too long for the basket.' } });
  let body: { lines?: unknown } | null = null;
  try { body = JSON.parse(read.text); } catch { body = null; }
  const raw = Array.isArray(body?.lines) ? (body?.lines as unknown[]) : [];
  const lines = raw
    .map((l) => ({
      productId: typeof (l as { productId?: unknown })?.productId === 'string' ? String((l as { productId: string }).productId).toLowerCase() : '',
      quantity: Number((l as { quantity?: unknown })?.quantity),
    }))
    .filter((l) => UUID.test(l.productId) && Number.isInteger(l.quantity) && l.quantity >= 1 && l.quantity <= CART_LINE_QUANTITY_CAP);
  if (lines.length === 0 || lines.length > CART_MAX_DISTINCT_LINES) {
    return json(400, {
      success: false,
      error: { code: 'BAD_LINES', message: `Send 1 to ${CART_MAX_DISTINCT_LINES} products, each 1 to ${CART_LINE_QUANTITY_CAP}.` },
    });
  }

  const session = await requestSession(locals, cookies);
  const credential = resolveCartCredential(cookies, session.state === 'USER' ? session.userId : null, {
    sessionUnknown: session.state === 'UNKNOWN',
  });
  if (!credential) {
    return json(503, { success: false, error: { code: 'CART_SESSION_UNAVAILABLE', message: cartMessageFor('CART_SESSION_UNAVAILABLE') } });
  }
  const sessionToken = cookies.get('goldplus_session')?.value ?? null;

  const before = await cartClient.read(credential.token, sessionToken);
  const inBasket = new Map<string, number>(before.ok ? before.cart.items.map((i) => [i.productId, i.quantity]) : []);

  const results: Outcome[] = [];
  let latest: CartView | null = before.ok ? before.cart : null;
  for (const line of lines) {
    const already = inBasket.get(line.productId) ?? 0;
    if (already + line.quantity > CART_LINE_QUANTITY_CAP) {
      results.push({
        productId: line.productId,
        outcome: 'over_cap',
        message: `Your basket already has ${already}. Together that is over ${CART_LINE_QUANTITY_CAP}, the basket's limit for one product.`,
      });
      continue;
    }
    const added = await cartClient.add(credential.token, { productId: line.productId, quantity: line.quantity }, sessionToken);
    if (added.ok) {
      latest = added.cart;
      inBasket.set(line.productId, already + line.quantity);
      results.push({ productId: line.productId, outcome: 'added' });
    } else {
      results.push({ productId: line.productId, outcome: 'refused', message: cartMessageFor(added.code) });
    }
  }

  // The device copy the basket page and the header read when the API is slow.
  // Written from the server's basket, only after it took at least one line.
  if (latest && results.some((r) => r.outcome === 'added')) {
    cookies.set(
      'goldplus_cart_data',
      JSON.stringify(latest.items.map((i) => ({
        productId: i.productId,
        slug: i.slug ?? '',
        name: i.name,
        categoryName: null,
        quantity: i.quantity,
        unitPriceUgx: i.unitPriceUgx,
      }))),
      { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', httpOnly: false },
    );
  }

  return json(200, {
    success: true,
    data: { results, addedCount: results.filter((r) => r.outcome === 'added').length },
  });
};
