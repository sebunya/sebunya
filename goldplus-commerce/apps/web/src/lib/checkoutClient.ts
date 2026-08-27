import type {
  CheckoutErrorCode,
  CheckoutRequestDto,
  CheckoutResponseDto,
  PaymentStartErrorCode,
  PaymentStartRequestDto,
  PaymentStartResponseDto,
} from '@goldplus/shared';
import { CHECKOUT_INTENT_HEADER } from '@goldplus/shared';
import { apiBase } from './api';

/**
 * The canonical, context-aware origin (apps/web/src/lib/api.ts): the internal
 * compose origin during SSR, the public origin in the browser.
 *
 * This file used to resolve PUBLIC_API_BASE_URL on its own. The checkout POST
 * runs in Astro frontmatter — server side — so every order creation hairpinned
 * out to the public edge, where Cloudflare answered Node's fetch with a 403
 * "Just a moment..." challenge page. The customer saw "Checkout failed" and no
 * order was ever created. Never resolve the API origin here; ask api.ts.
 */
const API_BASE = apiBase;

/**
 * Typed checkout client for the storefront BFF.
 *
 * The generic `postJson` helper returned an untyped payload and dropped every
 * response header. That is how the API's move to a minimal DTO returning
 * `orderId` went unnoticed while the page kept reading `res.data.id`: the value
 * was simply `undefined`, the PesaPal branch was skipped, and the customer was
 * shown the offline-review message instead of being sent to pay. A silently
 * broken payment handoff, with nothing failing loudly anywhere.
 *
 * This client is typed against the shared DTO, forwards the checkout intent, and
 * preserves the status, error code and Retry-After the storefront needs in order
 * to react differently to a conflict, an in-flight operation and an expired
 * intent.
 */

export type CheckoutCallResult =
  | { ok: true; data: CheckoutResponseDto; status: number }
  | {
      ok: false;
      status: number;
      code: CheckoutErrorCode | 'NETWORK';
      message: string;
      retryAfterSeconds?: number;
      /** Present on a blocked-stock refusal, which still carries the order. */
      details?: CheckoutResponseDto;
      /**
       * Present on CHECKOUT_ALREADY_ORDERED: the order this checkout already
       * produced, so the page can name it instead of refusing with nothing to act on.
       */
      existingOrder?: { orderId: string; orderNumber: string; paymentStatus: string };
    };



export async function submitCheckout(args: {
  request: CheckoutRequestDto;
  intentToken: string;
  /** Forwarded so the API can establish a verified USER principal. */
  sessionToken?: string | null;
  /** R3.1: the HttpOnly visit token (Astro.locals.gpVisit, SSR only) — lets the API stamp the order with its experience profile for commercial attribution. */
  visitToken?: string | null;
}): Promise<CheckoutCallResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    [CHECKOUT_INTENT_HEADER]: args.intentToken,
  };
  if (args.sessionToken) headers.Authorization = `Bearer ${args.sessionToken}`;
  if (args.visitToken) headers['x-gp-visit'] = args.visitToken;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/commerce/orders/create`, {
      method: 'POST',
      headers,
      body: JSON.stringify(args.request),
    });
  } catch {
    // A network failure is NOT a failed order: the request may have been
    // received and committed. The caller must retry with the SAME intent rather
    // than treating this as a rejection, which is what the idempotency claim is
    // for.
    return { ok: false, status: 0, code: 'NETWORK', message: 'The order service is unreachable.' };
  }

  const retryAfterRaw = res.headers.get('Retry-After');
  const retryAfterSeconds = retryAfterRaw ? Number(retryAfterRaw) : undefined;

  // Read the body ONCE as text, then parse. A refusal that is not JSON (an edge
  // challenge page, an HTML error page) is the case that used to vanish: the
  // customer saw a generic "could not place your order" and the operator had
  // nothing at all to go on.
  const raw = await res.text().catch(() => '');
  let json:
    | {
        success?: boolean;
        data?: CheckoutResponseDto;
        error?: {
          code?: string;
          message?: string;
          details?: CheckoutResponseDto;
          existingOrder?: { orderId: string; orderNumber: string; paymentStatus: string };
        };
      }
    | null = null;
  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = null;
  }

  if (res.ok && json?.success && json.data) {
    return { ok: true, data: json.data, status: res.status };
  }

  /**
   * One diagnostic line, server side only, so a broken order path is findable
   * in the logs. Deliberately NOTHING from the customer's request: only where
   * we called, what came back, and a short snippet of the RESPONSE when it was
   * not the JSON we expect.
   */
  if (import.meta.env.SSR) {
    console.error(
      '[checkout] order create refused ' +
        JSON.stringify({
          origin: API_BASE,
          status: res.status,
          contentType: res.headers.get('content-type'),
          bodyWasJson: json !== null,
          errorCode: json?.error?.code ?? null,
          snippet: json ? undefined : raw.slice(0, 160).replace(/\s+/g, ' '),
        }),
    );
  }

  return {
    ok: false,
    status: res.status,
    code: (json?.error?.code as CheckoutErrorCode) ?? 'ORDER_FAILED',
    // No HTTP number: it is not something a customer can act on.
    message: json?.error?.message ?? 'We could not place your order. Please try again.',
    ...(Number.isFinite(retryAfterSeconds) ? { retryAfterSeconds } : {}),
    ...(json?.error?.details ? { details: json.error.details } : {}),
    ...(json?.error?.existingOrder ? { existingOrder: json.error.existingOrder } : {}),
  };
}

/**
 * Starts payment through the API, forwarding the checkout intent.
 *
 * The storefront previously called this with the generic `postJson` helper and no
 * intent header, then showed the customer `payRes.message` on failure — which was
 * the API's own internal error text, including things like the server's missing
 * PesaPal IPN configuration. This client forwards the intent the API needs in order
 * to authorize the caller at all, and returns a stable code the page maps to
 * customer-safe wording.
 */
export type PaymentStartResult =
  | { ok: true; data: PaymentStartResponseDto }
  | { ok: false; status: number; code: PaymentStartErrorCode | 'NETWORK' };

export async function startPayment(args: {
  orderId: string;
  intentToken: string;
  sessionToken?: string | null;
}): Promise<PaymentStartResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    [CHECKOUT_INTENT_HEADER]: args.intentToken,
  };
  if (args.sessionToken) headers.Authorization = `Bearer ${args.sessionToken}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/commerce/payments/pesapal/start`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ orderId: args.orderId } satisfies PaymentStartRequestDto),
    });
  } catch {
    return { ok: false, status: 0, code: 'NETWORK' };
  }

  const json = (await res.json().catch(() => null)) as
    | { success?: boolean; data?: PaymentStartResponseDto; error?: { code?: string } }
    | null;

  // A redirect URL is required, not assumed: the whole point of the typed DTO is
  // that a missing field fails loudly here instead of silently skipping payment.
  if (res.ok && json?.success && json.data?.redirectUrl) {
    return { ok: true, data: json.data };
  }

  return {
    ok: false,
    status: res.status,
    code: (json?.error?.code as PaymentStartErrorCode) ?? 'PAYMENT_START_FAILED',
  };
}

/**
 * What to tell the customer when payment could not be started.
 *
 * Every branch is spelled out so no case falls through to the API's own message.
 */
export function paymentStartMessageFor(code: PaymentStartErrorCode | 'NETWORK'): string {
  switch (code) {
    case 'ORDER_ALREADY_PAID':
      return 'This order has already been paid. No further payment is needed.';
    case 'ORDER_NOT_PAYABLE':
      return 'This order cannot be paid for yet. Our team will contact you to confirm it.';
    case 'OFFLINE_DRAFT_NOT_PAYABLE':
      return 'This is a local draft saved on your device and cannot be paid for online.';
    case 'PAYMENT_NOT_CONFIGURED':
      return 'Online payment is temporarily unavailable. Your order is saved. Our team will contact you.';
    case 'PAYMENT_PROVIDER_UNAVAILABLE':
    case 'NETWORK':
      return 'We could not reach the payment service. Your order is saved. Please try again shortly.';
    case 'CHECKOUT_INTENT_REQUIRED':
      return 'Your checkout session expired. Please reload the page and try again.';
    case 'ORDER_NOT_FOUND':
    case 'PAYMENT_START_FAILED':
    default:
      // `default` so a code this client does not know (the API once returned
      // ORDER_ID_REQUIRED) cannot yield `undefined` and a blank error box.
      return 'We could not start payment for this order. Your order is saved. Please contact us and quote the order number shown here.';
  }
}

/**
 * Maps a checkout outcome to what the customer should be told.
 *
 * Kept beside the client so every branch is handled in one place rather than
 * inferred from a truthy order id, which is what let a blocked or conflicted
 * checkout read as an ordinary offline order.
 */
export function customerMessageFor(result: CheckoutCallResult): {
  status: 'received' | 'awaiting_payment' | 'error' | 'retry';
  message: string;
} {
  if (result.ok) {
    switch (result.data.nextAction) {
      case 'AWAIT_PAYMENT':
        return { status: 'awaiting_payment', message: 'Your order is ready for payment.' };
      case 'AWAIT_STOCK_CONFIRMATION':
        return {
          status: 'received',
          message: 'Your order was received. We are confirming stock and will contact you.',
        };
      case 'CONTACT_SUPPORT':
        return {
          status: 'error',
          message: 'Your order was recorded but needs our team to review it. We will contact you.',
        };
      case 'NONE':
        return { status: 'received', message: 'Your order is confirmed.' };
    }
  }

  switch (result.code) {
    case 'CHECKOUT_IN_PROGRESS':
      return {
        status: 'retry',
        message: 'This order is already being processed. Please wait a moment before retrying.',
      };
    case 'IDEMPOTENCY_CONFLICT':
      // A LIVE claim for a different basket: two submissions are racing. This is
      // a wait, not a dead end. It used to read "your basket changed since this
      // checkout started", which was also shown for a spent intent — telling a
      // customer whose basket had not changed to review a basket that was fine,
      // with no way forward.
      return {
        status: 'retry',
        message: 'This checkout is already being submitted. Please wait a moment, then try again.',
      };
    case 'CHECKOUT_INTENT_SPENT':
      // The page mints a fresh intent and resubmits, so this wording is only
      // ever reached if that recovery itself fails.
      return {
        status: 'retry',
        message: 'That checkout session had already been used. Please submit the form again.',
      };
    case 'CHECKOUT_ALREADY_ORDERED':
      // Deliberately NOT a second order. The page names the existing one and
      // links to it; this is the fallback wording.
      return {
        status: 'error',
        message: 'You already have an order from this checkout. Open it to pay for it or to check it, rather than ordering the same thing twice.',
      };
    case 'CHECKOUT_INTENT_EXPIRED':
    case 'CHECKOUT_INTENT_INVALID':
    case 'CHECKOUT_INTENT_REQUIRED':
    case 'CHECKOUT_INTENT_REVOKED':
      return {
        status: 'error',
        message: 'Your checkout session expired. Please reload the page and try again.',
      };
    case 'STOCK_NOT_RESERVED':
      return {
        status: 'error',
        message: 'Your order was recorded but stock could not be confirmed, so it cannot be paid for yet.',
      };
    case 'NETWORK':
      return {
        status: 'retry',
        message: 'We could not reach the order service. Please retry. Your order will not be duplicated.',
      };
    // The terminal business refusals. Each names what changed and what to do;
    // none of them fall through to the API's text. Nothing has been charged
    // on any of these — the order was refused before payment.
    case 'PRICE_CHANGED':
      return {
        status: 'error',
        message: 'A price changed while you were checking out. Please check the new total below, then place the order again. You have not been charged.',
      };
    case 'PROMOTION_CHANGED':
      return {
        status: 'error',
        message: 'An offer on your basket ended while you were checking out. Please check the new total below, then place the order again. You have not been charged.',
      };
    case 'PRODUCT_UNAVAILABLE':
      return {
        status: 'error',
        message: 'One of the items in your basket is no longer available. Please remove it from your cart and try again. You have not been charged.',
      };
    case 'PRICE_UNAVAILABLE':
      return {
        status: 'error',
        message: 'We could not confirm the price of an item in your basket. Please try again in a moment, or ask us about it. You have not been charged.',
      };
    case 'CHECKOUT_SESSION_UNAVAILABLE':
    case 'DB_NOT_CONFIGURED':
      return {
        status: 'retry',
        message: 'Checkout is temporarily unavailable. Please try again in a few minutes. Your basket is saved and you have not been charged.',
      };
    case 'INVALID_CHECKOUT':
      return {
        status: 'error',
        message: 'Some details are missing or do not look right. Please check the highlighted fields and try again.',
      };
    case 'ORDER_FAILED':
    case 'CHECKOUT_FAILED':
    default:
      return {
        status: 'error',
        message: 'We could not place your order. Please try again. You have not been charged. If it keeps failing, message us and we will take the order by phone.',
      };
  }
}
