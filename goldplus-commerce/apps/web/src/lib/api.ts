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

/**
 * SSR only: every request to the INTERNAL API origin carries
 * X-GoldPlus-Internal-Key, so the API returns product floors (Price A) that
 * the storefront needs for sale prices and strips for every other caller
 * (apps/api/.../middleware/floorPriceRedaction.ts). Installed once, here,
 * because this module is what every SSR fetch takes its origin from. The key
 * is sent to the internal origin and nowhere else, and never reaches a browser.
 */
/**
 * The default bound on an SSR READ of the internal API. Most page reads passed no
 * signal, so a stalled API (a saturated DB pool queues rather than fails) held
 * renders open for undici's 300s header timeout and pinned the web replicas.
 * Reads only: an aborted checkout or payment POST can leave an outcome the
 * customer cannot see, so writes keep whatever their caller chose.
 */
export const SSR_READ_TIMEOUT_MS = 8000;

export function withDefaultReadTimeout(input: RequestInfo | URL, init?: RequestInit): RequestInit | undefined {
  if (init?.signal || (typeof Request !== 'undefined' && input instanceof Request)) return init;
  const method = (init?.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return init;
  return { ...init, signal: AbortSignal.timeout(SSR_READ_TIMEOUT_MS) };
}

if (import.meta.env.SSR) {
  const env = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })?.process?.env ?? {};
  const internalOrigin = (env.INTERNAL_API_ORIGIN ?? '').replace(/\/+$/, '');
  const key = env.INTERNAL_API_KEY ?? '';
  const g = globalThis as unknown as { fetch: typeof fetch; __gpInternalKeyFetch?: boolean };
  if (internalOrigin && !g.__gpInternalKeyFetch) {
    const base = g.fetch.bind(globalThis);
    g.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.startsWith(`${internalOrigin}/`)) return base(input, init);
      const bounded = withDefaultReadTimeout(input, init);
      if (!key) return base(input, bounded);
      const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
      headers.set('X-GoldPlus-Internal-Key', key);
      return base(input, { ...bounded, headers });
    };
    g.__gpInternalKeyFetch = true;
  }
}

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

/**
 * The reference a form confirmation shows. The governance endpoints answer
 * `{ data: { ticketId | quoteId | dealerId | reportId } }` with no `meta`, so
 * reading only `meta.requestId` showed no reference at all — while the support
 * page told the customer to "keep the reference below". The record's own id is
 * the reference: it is exactly what the acknowledgement SMS quotes and what
 * the team finds the request by.
 */
export function formReference(json: { data?: unknown; meta?: { requestId?: unknown } } | null | undefined): string | undefined {
  const data = (json?.data && typeof json.data === 'object' ? json.data : {}) as Record<string, unknown>;
  for (const key of ['ticketId', 'quoteId', 'dealerId', 'reportId'] as const) {
    if (typeof data[key] === 'string' && data[key]) return data[key] as string;
  }
  return typeof json?.meta?.requestId === 'string' ? json.meta.requestId : undefined;
}

/** `bearer`: the signed-in session token, forwarded when the action is attributable (a verification scan earns points). */
export async function postJson(path: string, body: unknown, bearer?: string | null): Promise<FormPostResult> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
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
    return { ok: true, reference: formReference(json), data: json.data };
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
