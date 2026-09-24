import { CART_CREDENTIAL_HEADER } from '@goldplus/shared';
import { apiBase } from './api';

/**
 * Typed cart client for the storefront BFF.
 *
 * The pages called `fetch` inline with a hand-built body per action, dropped every
 * response, and swallowed failures into a console warning while updating a local
 * cookie regardless. So a rejected server write looked identical to an accepted one:
 * the customer saw their basket change, and the server's basket did not. That
 * divergence surfaced at checkout, where the server's cart is the authority.
 *
 * This client is typed, forwards the credential, and returns the server's view of the
 * basket so the caller can reconcile instead of assuming.
 */

/**
 * Context-aware origin from api.ts: internal during SSR, public in the browser.
 * The cart pages call this from Astro frontmatter, so resolving the public
 * origin here sent server-side basket writes out through the public edge, where
 * Cloudflare answers Node's fetch with a 403 challenge page.
 */
const API_BASE = apiBase;

export interface CartLineView {
  productId: string;
  name: string;
  /** The product page's slug; absent from an older API, so never assumed. */
  slug?: string;
  unitPriceUgx: number;
  quantity: number;
  /** The product can no longer be bought; excluded from the server's subtotal. */
  unavailable?: boolean;
}

export interface CartView {
  id: string;
  version: number;
  items: CartLineView[];
  subtotalUgx: number;
}

export type CartErrorCode =
  | 'CART_NOT_FOUND'
  | 'VERSION_CONFLICT'
  | 'PRODUCT_UNAVAILABLE'
  | 'QUANTITY_OUT_OF_BOUNDS'
  | 'CART_LIMIT_EXCEEDED'
  | 'RETRYABLE_FAILURE'
  | 'INVALID_CART_REQUEST'
  | 'CART_CREDENTIAL_REQUIRED'
  | 'CART_CREDENTIAL_EXPIRED'
  | 'CART_CREDENTIAL_INVALID'
  | 'CART_SESSION_UNAVAILABLE'
  | 'NETWORK';

export type CartCallResult =
  | { ok: true; cart: CartView }
  | {
      ok: false;
      status: number;
      code: CartErrorCode;
      /** Present on a version conflict: the basket as the server now holds it. */
      cart?: CartView;
      /** Present on PRODUCT_UNAVAILABLE, so the page can name the offending lines. */
      productIds?: string[];
    };

type CartAction =
  | { path: '/commerce/cart'; method: 'GET' }
  | { path: '/commerce/cart/add'; method: 'POST'; body: { productId: string; quantity?: number; expectedVersion?: number } }
  | { path: '/commerce/cart/update'; method: 'POST'; body: { productId: string; quantity: number; expectedVersion?: number } }
  | { path: '/commerce/cart/remove'; method: 'POST'; body: { productId: string; expectedVersion?: number } }
  | { path: '/commerce/cart/clear'; method: 'POST'; body: { expectedVersion?: number } };

async function call(
  action: CartAction,
  credential: string,
  sessionToken?: string | null,
): Promise<CartCallResult> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    [CART_CREDENTIAL_HEADER]: credential,
  };
  if (action.method === 'POST') headers['Content-Type'] = 'application/json';
  // Forwarded so the API can cross-check a USER-owned basket against the session. A
  // user credential presented without the session is refused, deliberately.
  if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${action.path}`, {
      method: action.method,
      headers,
      body: action.method === 'POST' ? JSON.stringify(action.body) : undefined,
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // A network failure is NOT an empty basket. The caller must keep showing what it
    // last knew rather than rendering the customer's basket as cleared.
    return { ok: false, status: 0, code: 'NETWORK' };
  }

  const json = (await res.json().catch(() => null)) as
    | {
        success?: boolean;
        data?: CartView;
        error?: { code?: string; details?: CartView | { productIds?: string[] } };
      }
    | null;

  if (res.ok && json?.success && json.data) return { ok: true, cart: json.data };

  const code = (json?.error?.code as CartErrorCode) ?? 'RETRYABLE_FAILURE';
  const details = json?.error?.details;
  return {
    ok: false,
    status: res.status,
    code,
    ...(code === 'VERSION_CONFLICT' && details && 'version' in details ? { cart: details as CartView } : {}),
    ...(details && 'productIds' in details && Array.isArray(details.productIds)
      ? { productIds: details.productIds }
      : {}),
  };
}

export const cartClient = {
  read: (credential: string, sessionToken?: string | null) =>
    call({ path: '/commerce/cart', method: 'GET' }, credential, sessionToken),

  add: (
    credential: string,
    body: { productId: string; quantity?: number; expectedVersion?: number },
    sessionToken?: string | null,
  ) => call({ path: '/commerce/cart/add', method: 'POST', body }, credential, sessionToken),

  update: (
    credential: string,
    body: { productId: string; quantity: number; expectedVersion?: number },
    sessionToken?: string | null,
  ) => call({ path: '/commerce/cart/update', method: 'POST', body }, credential, sessionToken),

  remove: (
    credential: string,
    body: { productId: string; expectedVersion?: number },
    sessionToken?: string | null,
  ) => call({ path: '/commerce/cart/remove', method: 'POST', body }, credential, sessionToken),

  clear: (credential: string, body: { expectedVersion?: number }, sessionToken?: string | null) =>
    call({ path: '/commerce/cart/clear', method: 'POST', body }, credential, sessionToken),

  /**
   * The basket a signed-in customer's new credential should name: their newest
   * account basket, with the guest basket they arrived with merged in. Null on any
   * failure, and the caller mints a fresh basket exactly as it did before.
   */
  accountCart: async (sessionToken: string, guestCredential?: string | null): Promise<string | null> => {
    try {
      const res = await fetch(`${API_BASE}/commerce/cart/account`, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify(guestCredential ? { guestCredential } : {}),
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) return null;
      const json = (await res.json().catch(() => null)) as { success?: boolean; data?: { cartId?: unknown } } | null;
      const cartId = json?.success ? json.data?.cartId : undefined;
      return typeof cartId === 'string' && /^[0-9a-f-]{36}$/i.test(cartId) ? cartId : null;
    } catch {
      return null;
    }
  },
};

/**
 * What to tell the customer. Exhaustive over the typed codes, so no branch can fall
 * through to a passed-through server message.
 */
export function cartMessageFor(code: CartErrorCode): string {
  switch (code) {
    case 'VERSION_CONFLICT':
      return 'Your basket changed in another tab. We have refreshed it. Please check and try again.';
    case 'PRODUCT_UNAVAILABLE':
      return 'One or more items are no longer available. Please review your basket.';
    case 'QUANTITY_OUT_OF_BOUNDS':
      return 'You can order 1 to 99 of one product at a time.';
    case 'CART_LIMIT_EXCEEDED':
      return 'Your basket has too many different products. Please remove some before adding more.';
    case 'CART_NOT_FOUND':
    case 'CART_CREDENTIAL_REQUIRED':
    case 'CART_CREDENTIAL_EXPIRED':
    case 'CART_CREDENTIAL_INVALID':
      return 'Your basket session expired. Please reload the page.';
    case 'CART_SESSION_UNAVAILABLE':
    case 'RETRYABLE_FAILURE':
    case 'NETWORK':
      return 'The basket service is temporarily unavailable. Please try again shortly.';
    case 'INVALID_CART_REQUEST':
      return 'That basket request could not be understood. Please reload the page.';
  }
}
