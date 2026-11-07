import { apiBase } from './api';
import { CHECKOUT_INTENT_HEADER } from '@goldplus/shared';

/**
 * 0222: pay in parts (lay-by). The terms are the owner's settings, read from the API so the page never states a
 * number the server does not apply.
 */
export interface PayInPartsTerms {
  depositPercent: number;
  termDays: number;
  cancellationFeePercent: number;
  minGoodsUgx: number;
  reminderDays: number[];
}

/** The owner's decisions (2026-11-07), shown only if the API cannot be reached; the server applies its own. */
export const FALLBACK_TERMS: PayInPartsTerms = { depositPercent: 30, termDays: 30, cancellationFeePercent: 10, minGoodsUgx: 100_000, reminderDays: [20, 27] };

export async function getPayInPartsTerms(): Promise<{ terms: PayInPartsTerms; live: boolean }> {
  try {
    const res = await fetch(`${apiBase}/commerce/pay-in-parts/terms`, { signal: AbortSignal.timeout(3000) });
    const json = (await res.json().catch(() => null)) as { success?: boolean; data?: { terms?: PayInPartsTerms } } | null;
    if (res.ok && json?.success && json.data?.terms) return { terms: json.data.terms, live: true };
  } catch { /* fall through */ }
  return { terms: FALLBACK_TERMS, live: false };
}

/** The same terms in plain words, everywhere they are shown. */
export function termsInWords(t: PayInPartsTerms): string[] {
  return [
    `Pay ${t.depositPercent}% of the order total now, and the rest in any amounts within ${t.termDays} days.`,
    'We hold your items for you. We deliver them, or you collect them, once everything is paid.',
    `We text you a reminder on day ${t.reminderDays.join(' and day ')} if something is still to pay.`,
    `If you cancel, or ${t.termDays} days pass before it is all paid, the order is cancelled and we refund what you paid less a fee of ${t.cancellationFeePercent}% of what you paid.`,
    `For orders of UGX ${t.minGoodsUgx.toLocaleString('en-US')} or more (goods, before delivery). No interest and no other charges.`,
  ];
}

export type LaybyStartResult = { ok: true; redirectUrl: string; reference: string } | { ok: false; status: number; code: string; message: string };

async function post(path: string, body: unknown, headers: Record<string, string> = {}): Promise<LaybyStartResult> {
  try {
    const res = await fetch(`${apiBase}/commerce/pay-in-parts/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', ...headers },
      body: JSON.stringify(body), signal: AbortSignal.timeout(15000),
    });
    const json = (await res.json().catch(() => null)) as { success?: boolean; data?: { redirectUrl?: string; reference?: string }; error?: { code?: string; message?: string } } | null;
    if (res.ok && json?.success && json.data?.redirectUrl) return { ok: true, redirectUrl: json.data.redirectUrl, reference: String(json.data.reference ?? '') };
    return { ok: false, status: res.status, code: String(json?.error?.code ?? 'FAILED'), message: json?.error?.message ?? 'We could not open the payment page. Nothing was charged.' };
  } catch {
    return { ok: false, status: 0, code: 'NETWORK', message: 'We could not reach the payment service. Nothing was charged. Please try again.' };
  }
}

/** The deposit for the order this checkout just created (the checkout intent proves it is theirs). */
export function startLaybyDeposit(args: { orderId: string; intentToken: string; sessionToken?: string | null }): Promise<LaybyStartResult> {
  return post('start', { orderId: args.orderId }, { [CHECKOUT_INTENT_HEADER]: args.intentToken, ...(args.sessionToken ? { Authorization: `Bearer ${args.sessionToken}` } : {}) });
}
