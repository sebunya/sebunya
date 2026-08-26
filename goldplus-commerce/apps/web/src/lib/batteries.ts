import { apiBase } from './api';

/**
 * Battery module client. Admin calls carry the operator's session token; public
 * finder calls carry only the anonymous finder-session header. Nothing here
 * invents a fallback: an unreachable service is reported as unreachable, never
 * as an empty catalogue.
 */

export interface AdminResult<T> {
  ok: boolean;
  data: T | null;
  error: { code: string; message: string; details?: unknown } | null;
  status: number;
}

export async function adminBattery<T>(path: string, token: string, init?: RequestInit & { form?: FormData }): Promise<AdminResult<T>> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (!init?.form) headers['Content-Type'] = 'application/json';
  try {
    const res = await fetch(`${apiBase}/admin/batteries${path}`, {
      method: init?.method ?? 'GET',
      headers: { ...headers, ...(init?.headers as Record<string, string> | undefined) },
      body: init?.form ?? init?.body,
      signal: AbortSignal.timeout(15_000),
    });
    const json = await res.json().catch(() => null);
    if (json?.success) return { ok: true, data: json.data as T, error: null, status: res.status };
    return { ok: false, data: null, error: json?.error ?? { code: 'UNAVAILABLE', message: `The battery service replied ${res.status}.` }, status: res.status };
  } catch {
    return { ok: false, data: null, error: { code: 'UNREACHABLE', message: 'The battery service is unreachable right now.' }, status: 0 };
  }
}

/** Message an operator can act on, mapped from the use-case refusal codes. */
export function batteryMessage(error: { code: string; message: string } | null): string {
  if (!error) return 'Something went wrong.';
  switch (error.code) {
    case 'UNREACHABLE': return 'The battery service is unreachable right now. Nothing was changed.';
    case 'FORBIDDEN': return 'You do not have the right to do that. Ask an administrator.';
    case 'PERMISSION_DENIED': return 'You do not have the right to do that. Ask an administrator.';
    default: return error.message;
  }
}

export type PublicResult<T> = { ok: true; data: T } | { ok: false; unavailable: true };

export interface BatteryRequestInput {
  queryText: string | null;
  brandText: string | null;
  deviceText: string | null;
  modelNumberText: string | null;
  batteryCodeText: string | null;
  contactName: string | null;
  contactPhone: string | null;
  notes: string | null;
  source: 'FINDER_NO_RESULT' | 'PRODUCT_PAGE';
}

/**
 * Record a customer's battery request from the server.
 *
 * This calls the API through `apiBase`, which is the internal compose origin
 * during SSR. It must never post to our own public origin: a server-side fetch
 * out to the edge and back is answered by Cloudflare with a 403 challenge page,
 * which is exactly how the checkout funnel was silently dying.
 */
export async function submitBatteryRequest(input: BatteryRequestInput): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${apiBase}/batteries/finder/requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json().catch(() => null);
    if (json?.success) {
      return { ok: true, message: 'Thank you. We have your phone details and will confirm the right battery before you buy.' };
    }
    return { ok: false, message: json?.error?.message ?? 'We could not record that just now. Please send it to us on WhatsApp instead.' };
  } catch {
    return { ok: false, message: 'We could not record that just now. Please send it to us on WhatsApp instead.' };
  }
}

export async function publicBattery<T>(path: string, sessionId?: string | null): Promise<PublicResult<T>> {
  try {
    const res = await fetch(`${apiBase}/batteries${path}`, {
      headers: { Accept: 'application/json', ...(sessionId ? { 'x-gp-finder-session': sessionId } : {}) },
      signal: AbortSignal.timeout(4000),
    });
    const json = await res.json().catch(() => null);
    if (json?.success) return { ok: true, data: json.data as T };
    return { ok: false, unavailable: true };
  } catch {
    return { ok: false, unavailable: true };
  }
}

/** The device a customer is shopping for. Slug + label only; no personal data. */
export const DEVICE_COOKIE = 'gp_battery_device';

export interface SelectedDevice {
  slug: string;
  label: string;
}

export function parseDeviceCookie(raw: string | undefined | null): SelectedDevice | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(raw)) as Partial<SelectedDevice>;
    if (!parsed?.slug || !parsed?.label) return null;
    if (!/^[a-z0-9-]{1,160}$/.test(parsed.slug)) return null;
    return { slug: parsed.slug, label: String(parsed.label).slice(0, 120) };
  } catch {
    return null;
  }
}

export function serialiseDeviceCookie(device: SelectedDevice): string {
  return encodeURIComponent(JSON.stringify({ slug: device.slug, label: device.label.slice(0, 120) }));
}

export const ugx = (n: number | null | undefined): string => (typeof n === 'number' && n > 0 ? `UGX ${n.toLocaleString('en-UG')}` : 'Price on request');

/** Badge classes per public fit state. Colour is never the only signal; the label carries the meaning. */
export const FIT_BADGE: Record<string, string> = {
  VERIFIED_IN_STOCK: 'border-green-300 bg-green-50 text-green-800',
  VERIFIED_OUT_OF_STOCK: 'border-slate-300 bg-slate-50 text-slate-700',
  CONDITIONAL: 'border-amber-300 bg-amber-50 text-amber-900',
  AWAITING_VERIFICATION: 'border-blue-200 bg-blue-50 text-blue-900',
};

export const LIFECYCLE_BADGE: Record<string, string> = {
  ACTIVE: 'bg-green-50 text-green-800 border-green-200',
  READY: 'bg-blue-50 text-blue-800 border-blue-200',
  REVIEW: 'bg-amber-50 text-amber-900 border-amber-200',
  DRAFT: 'bg-slate-100 text-slate-700 border-slate-200',
  ARCHIVED: 'bg-slate-50 text-slate-500 border-slate-200',
};
