const API_BASE = (import.meta.env.PUBLIC_API_BASE_URL as string | undefined) ?? 'http://localhost:3000';

export type ApiEnvelope<T> = {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
  meta?: { requestId?: string; [k: string]: unknown };
};

export type AdminListResult<T> =
  | { items: T[]; isSample: false }
  | { items: T[]; isSample: true; reason: string };

export async function tryFetchAdminList<T>(
  path: string,
  fallback: T[],
  reasonPrefix = 'Sample data shown until the GET endpoint is wired.',
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
      return { items: fallback, isSample: true, reason: `${reasonPrefix} (API ${res.status})` };
    }
    const json = (await res.json().catch(() => null)) as ApiEnvelope<T[]> | null;
    if (!json || !json.success || !Array.isArray(json.data)) {
      return { items: fallback, isSample: true, reason: `${reasonPrefix} (unexpected response)` };
    }
    return { items: json.data, isSample: false };
  } catch {
    return { items: fallback, isSample: true, reason: `${reasonPrefix} (API unreachable)` };
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
        message: json?.error?.message ?? `Request failed (HTTP ${res.status}).`,
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
      return { items: [], isSample: true, reason: `Timeline query failed (HTTP ${res.status})` };
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

export const whatsappSupportNumber = (import.meta.env.PUBLIC_WHATSAPP_SUPPORT_NUMBER as string | undefined) ?? (import.meta.env.WHATSAPP_SUPPORT_NUMBER as string | undefined) ?? '256705004545';
export const whatsappSupportLabel = (import.meta.env.PUBLIC_WHATSAPP_SUPPORT_LABEL as string | undefined) ?? (import.meta.env.WHATSAPP_SUPPORT_LABEL as string | undefined) ?? 'GoldPlus Support';
