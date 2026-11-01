import { apiBase } from './api';

/**
 * Server-side calls for the advertising admin pages (/admin/advertising/*).
 * Always the internal API base (never the public host: SSR must not hairpin).
 * Tokens entered in these forms are passed straight to the API, which stores
 * them encrypted; nothing here echoes one back.
 */
export type ApiResult<T = any> = { ok: true; data: T } | { ok: false; message: string; data?: T };

export async function advertisingApi<T = any>(token: string, method: string, path: string, body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(`${apiBase}/admin/advertising${path}`, {
      method,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => null);
    if (res.status === 401 || res.status === 403) return { ok: false, message: 'Your account cannot manage advertising settings (settings.manage).' };
    if (res.ok && json?.success) return { ok: true, data: json.data as T };
    return { ok: false, message: json?.error?.message ?? `The API declined the request (HTTP ${res.status}).`, data: json?.data as T };
  } catch {
    return { ok: false, message: 'Could not reach the API.' };
  }
}

/** A capability form post (intent capability-save / capability-enable / capability-disable / capability-remove-token). */
export async function saveCapabilityFromForm(token: string, f: FormData): Promise<ApiResult> {
  const platform = String(f.get('platform') ?? '');
  const capability = String(f.get('capability') ?? '');
  const intent = String(f.get('intent') ?? '');
  const config: Record<string, string> = {};
  for (const [k, v] of f.entries()) if (k.startsWith('cfg.')) config[k.slice(4)] = String(v).trim();
  // The list checkboxes become the comma list the API validates.
  const segs = f.getAll('segment').map(String);
  if (f.has('segments-present')) config.segments = segs.length === 3 ? '' : segs.join(',');
  // The owner's own segments (first-party module), by key; none ticked = none synced.
  if (f.has('custom-segments-present')) config.customSegments = f.getAll('customSegment').map(String).slice(0, 10).join(',');
  const secret = String(f.get('secret') ?? '').trim() || undefined;
  const body = intent === 'capability-remove-token' ? { removeSecret: true }
    : { config, secret, enabled: intent === 'capability-enable' ? true : intent === 'capability-disable' ? false : undefined };
  return advertisingApi(token, 'PUT', `/capabilities/${encodeURIComponent(platform)}/${encodeURIComponent(capability)}`, body);
}

export const STATE_BADGE: Record<string, [string, string]> = {
  LIVE: ['Live', 'bg-emerald-100 text-emerald-900'],
  TEST: ['Test', 'bg-sky-100 text-sky-900'],
  READY: ['Ready', 'bg-emerald-50 text-emerald-900'],
  READY_OFF: ['Configured, switched off', 'bg-amber-100 text-amber-900'],
  NOT_CONFIGURED: ['Not configured', 'bg-gray-100 text-gray-700'],
  NOT_AVAILABLE: ['Needs an outside account first', 'bg-gray-100 text-gray-600'],
};

export const PLATFORM_NAME: Record<string, string> = { google_ads: 'Google Ads', meta: 'Meta', tiktok: 'TikTok' };

/**
 * An audience run's status as admin shows it. A Google upload is only
 * "Sent, waiting for Google" until Google confirms it (0159); it is never
 * shown as synced on our own say-so.
 */
const CONFIRMATION_LABEL: Record<string, string> = {
  WAITING: 'Sent, waiting for Google', SWEEPING: 'Sent, waiting for Google', CONFIRMED: 'Confirmed by Google',
  PARTIAL: 'Partly accepted by Google', FAILED: 'Rejected by Google', UNCONFIRMED: 'Not confirmed by Google',
};
export function audienceRunStatus(r: { status?: unknown; confirmation?: unknown }): string {
  const c = typeof r.confirmation === 'string' ? CONFIRMATION_LABEL[r.confirmation] : undefined;
  return c ?? String(r.status ?? '');
}
/** The run's message, followed by Google's confirmation detail when there is one. */
export function audienceRunMessage(r: { message?: unknown; confirmationDetail?: unknown }): string {
  return [r.message, r.confirmationDetail].filter((x) => typeof x === 'string' && x).join(' ');
}

export const whenKampala = (iso: unknown) => (typeof iso === 'string' && iso
  ? new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Kampala' })
  : '—');

/** A whole number for display (counts, UGX amounts). */
export const fmtInt = (v: number | string) => new Intl.NumberFormat('en-GB').format(Number(v));

/** Minor units → display amount in the currency's own digits (UGX has none). */
export function money(minor: number, currency: string): string {
  const zero = ['UGX', 'RWF', 'JPY', 'KRW', 'BIF', 'XAF', 'XOF'].includes(currency);
  const v = zero ? minor : minor / 100;
  return `${currency} ${v.toLocaleString('en-GB', { minimumFractionDigits: zero ? 0 : 2, maximumFractionDigits: zero ? 0 : 2 })}`;
}
