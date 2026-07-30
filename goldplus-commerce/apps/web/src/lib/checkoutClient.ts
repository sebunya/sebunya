import type {
  CheckoutErrorCode,
  CheckoutResponseDto,
} from '@goldplus/shared';
import { CHECKOUT_INTENT_HEADER } from '@goldplus/shared';

const API_BASE = (
  import.meta.env.PUBLIC_API_BASE_URL ||
  process.env.PUBLIC_API_BASE_URL ||
  'http://localhost:3000'
).replace(/\/+$/, '');

/**
 * Typed checkout client for the storefront BFF.
 *
 * The generic `postJson` helper returned `data: unknown` and dropped every
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
    };

export interface CheckoutRequest {
  customerDetails: unknown;
  buyerType: string;
  items: unknown;
  clientOrderKey: string;
  couponCode?: string | null;
  previewQuoteId?: string | null;
  acceptPriceChange?: boolean;
}

export async function submitCheckout(args: {
  request: CheckoutRequest;
  intentToken: string;
  /** Forwarded so the API can establish a verified USER principal. */
  sessionToken?: string | null;
}): Promise<CheckoutCallResult> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    [CHECKOUT_INTENT_HEADER]: args.intentToken,
  };
  if (args.sessionToken) headers.Authorization = `Bearer ${args.sessionToken}`;

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

  const json = (await res.json().catch(() => null)) as
    | { success?: boolean; data?: CheckoutResponseDto; error?: { code?: string; message?: string; details?: CheckoutResponseDto } }
    | null;

  if (res.ok && json?.success && json.data) {
    return { ok: true, data: json.data, status: res.status };
  }

  return {
    ok: false,
    status: res.status,
    code: (json?.error?.code as CheckoutErrorCode) ?? 'ORDER_FAILED',
    message: json?.error?.message ?? `Checkout failed (HTTP ${res.status}).`,
    ...(Number.isFinite(retryAfterSeconds) ? { retryAfterSeconds } : {}),
    ...(json?.error?.details ? { details: json.error.details } : {}),
  };
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
      return {
        status: 'error',
        message: 'Your basket changed since this checkout started. Please review it and submit again.',
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
        message: 'We could not reach the order service. Please retry — your order will not be duplicated.',
      };
    default:
      return { status: 'error', message: result.message };
  }
}
