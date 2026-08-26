/**
 * Canonical API origin resolution.
 *
 * Two origins, one rule: never hairpin SSR through the public edge, and never
 * emit a relative URL to Node's fetch (which throws "Failed to parse URL").
 *
 * - Browser: the PUBLIC origin (build-inlined PUBLIC_API_BASE_URL). Empty is
 *   treated as UNSET (|| not ??) so a missing build arg falls back rather than
 *   producing a relative request.
 * - SSR (Node, web container): an absolute INTERNAL origin read at RUNTIME from
 *   process.env.INTERNAL_API_ORIGIN (e.g. http://api:3000, the API service on the
 *   compose network). Read via globalThis.process so it is not baked at build.
 */
const PUBLIC_API_ORIGIN =
  ((import.meta.env.PUBLIC_API_BASE_URL as string | undefined) || 'http://localhost:3000');

function resolveApiOrigin(): string {
  if (import.meta.env.SSR) {
    const internal = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })
      ?.process?.env?.INTERNAL_API_ORIGIN;
    if (typeof internal === 'string' && internal.length > 0) return internal.replace(/\/+$/, '');
    return PUBLIC_API_ORIGIN.replace(/\/+$/, '');
  }
  return PUBLIC_API_ORIGIN.replace(/\/+$/, '');
}

const API_BASE = resolveApiOrigin();

export type ApiEnvelope<T> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
  meta?: { requestId?: string; [k: string]: unknown };
};

export type AdminListResult<T> =
  | { items: T[]; isSample: false }
  | { items: T[]; isSample: true; reason: string };

/**
 * Slice 10 (§7 simplification): this used to return fabricated `fallback` sample
 * rows whenever the API was unreachable, presenting an unreachable API as a
 * product state. It now returns an HONEST degraded state — an empty list plus a
 * reason — and never invents records. The `fallback` parameter is retained for
 * call-site compatibility but is intentionally ignored; callers render an honest
 * empty/degraded state from `isSample` + `reason`.
 */
export async function tryFetchAdminList<T>(
  path: string,
  _fallback: T[] = [],
  reasonPrefix = 'Live data could not be loaded from the API.',
  token?: string | null,
): Promise<AdminListResult<T>> {
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(`${API_BASE}${path}`, {
      headers,
    });
    if (!res.ok) {
      return { items: [], isSample: true, reason: `${reasonPrefix} (API ${res.status})` };
    }
    const json = (await res.json().catch(() => null)) as ApiEnvelope<T[]> | null;
    if (!json || !json.success || !Array.isArray(json.data)) {
      return { items: [], isSample: true, reason: `${reasonPrefix} (unexpected response)` };
    }
    return { items: json.data, isSample: false };
  } catch {
    return { items: [], isSample: true, reason: `${reasonPrefix} (API unreachable)` };
  }
}

export type FormPostResult =
  | { ok: true; reference?: string; data?: unknown }
  | { ok: false; code: 'NETWORK' | 'API_ERROR'; message: string };

export async function postJson(path: string, body: unknown): Promise<FormPostResult> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => null)) as ApiEnvelope<unknown> | null;
    if (!res.ok || !json || !json.success) {
      return {
        ok: false,
        code: 'API_ERROR',
        // Never an HTTP number: a customer cannot act on it.
        message: json?.error?.message ?? 'We could not send that just now. Please try again in a moment.',
      };
    }
    const reference = (json.meta?.requestId as string | undefined) ?? undefined;
    return { ok: true, reference, data: json.data };
  } catch {
    return {
      ok: false,
      code: 'NETWORK',
      message: 'The API is unreachable from the web server.',
    };
  }
}

export interface FrontendTimelineItem {
  id: string;
  type: 'attempt' | 'outbox';
  channel: string;
  recipient: string;
  template: string;
  status: string;
  timestamp: string;
  providerCode: string | null;
  providerMessage: string | null;
  idempotencyKey: string | null;
  dryRunOnly: boolean;
  previewOnly: boolean;
  noSendGuarantee: boolean;
  suppressedReason: string | null;
}

export async function getOrderNotificationTimeline(
  orderId: string,
  token: string
): Promise<AdminListResult<FrontendTimelineItem>> {
  try {
    const res = await fetch(`${API_BASE}/admin/notifications/order/${orderId}/timeline`, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${token}`
      }
    });
    if (!res.ok) {
      return { items: [], isSample: true, reason: 'The timeline could not be loaded.' };
    }
    const json = (await res.json().catch(() => null)) as ApiEnvelope<FrontendTimelineItem[]> | null;
    if (!json || !json.success || !Array.isArray(json.data)) {
      return { items: [], isSample: true, reason: 'Timeline query returned unexpected response structure' };
    }
    return { items: json.data, isSample: false };
  } catch {
    return { items: [], isSample: true, reason: 'Notifications API is unreachable' };
  }
}

export const apiBase = API_BASE;

/**
 * The BROWSER-facing origin, for values that end up in HTML the client consumes
 * (data-* attributes, inline script config). `apiBase` is runtime-resolved and
 * during SSR points at the compose-internal origin (http://api:3000) — handing
 * that to a browser makes every fetch fail and the feature report itself
 * unavailable. Anything serialized into the page must use this instead.
 */
export const publicApiBase = PUBLIC_API_ORIGIN.replace(/\/+$/, '');

export const whatsappSupportNumber = (import.meta.env.PUBLIC_WHATSAPP_SUPPORT_NUMBER as string | undefined) ?? (import.meta.env.WHATSAPP_SUPPORT_NUMBER as string | undefined) ?? '256705004545';
export const whatsappSupportLabel = (import.meta.env.PUBLIC_WHATSAPP_SUPPORT_LABEL as string | undefined) ?? (import.meta.env.WHATSAPP_SUPPORT_LABEL as string | undefined) ?? 'GoldPlus Support';
