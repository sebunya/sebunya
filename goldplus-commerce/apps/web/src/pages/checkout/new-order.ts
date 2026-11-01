import type { APIRoute } from 'astro';
import { clearCheckoutIntent } from '../../lib/checkoutIntent';
import { checkRequestOrigin } from '../../lib/requestOrigin';

/**
 * "Place this basket as a new order", offered when checkout answered CHECKOUT_ALREADY_ORDERED: this browser's
 * checkout intent already produced an unpaid order, and the basket now on screen is a different one. The API
 * keeps the intent on that order on purpose (a changed basket must not silently become a second order), so the
 * customer decides here, explicitly. Dropping the intent makes the next "Complete order" a new checkout; the earlier
 * order stays payable from its tracking page. POST and same-origin only, so no other site can press it.
 */
export const POST: APIRoute = ({ request, cookies }) => {
  const origin = checkRequestOrigin(request, import.meta.env as unknown as Record<string, string | undefined>);
  if (origin.allowed) clearCheckoutIntent(cookies);
  return new Response(null, { status: 303, headers: { Location: origin.allowed ? '/checkout?new_order=1' : '/checkout' } });
};
