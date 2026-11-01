import { apiFetch } from '../utils/api-fetch';

/**
 * Server-side calls for the controlled-activation live-review pages.
 *
 * The pages used to identify the admin with a hard-coded 'admin-123' in an
 * `x-user-id` header and never sent the session token. The API authenticates
 * with the Bearer token, so every read answered 401 ("Failed to load") and every
 * button — fired straight from the browser with the same fake identity — could
 * never act. All calls now go from the server with the admin's own session.
 */
const BASE = '/admin/controlled-activation-live-review/live-review-candidates';

export type LiveReviewAction =
  | { kind: 'checks' }
  | { kind: 'runbook' }
  | { kind: 'approval'; status: 'APPROVED' | 'REJECTED' | 'NEEDS_CHANGES'; note: string };

export async function liveReviewGet<T>(token: string, path = ''): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await apiFetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    if (res.ok) return { ok: true, data: (await res.json()) as T };
    return { ok: false, error: describe(res.status) };
  } catch {
    return { ok: false, error: 'The live-review service could not be reached.' };
  }
}

export async function liveReviewAct(token: string, candidateId: string, action: LiveReviewAction): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = encodeURIComponent(candidateId);
  const [path, body] =
    action.kind === 'checks' ? [`/${id}/checks`, undefined]
      : action.kind === 'runbook' ? [`/${id}/runbook`, undefined]
        : [`/${id}/stakeholder-approval`, JSON.stringify({ approvalStatus: action.status, approvalNote: action.note })];
  try {
    const res = await apiFetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body,
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) return { ok: true };
    // The API answers either { error: 'text' } or { error: { code, message } }.
    const json = (await res.json().catch(() => null)) as { error?: unknown } | null;
    const err = json?.error as { message?: unknown } | string | undefined;
    const message = typeof err === 'string' ? err : typeof err?.message === 'string' ? err.message : null;
    return { ok: false, error: message ? `${describe(res.status)} (${message})` : describe(res.status) };
  } catch {
    return { ok: false, error: 'The live-review service could not be reached.' };
  }
}

function describe(status: number): string {
  if (status === 401) return 'Your session has expired. Sign in again.';
  if (status === 403) return 'Your account does not have permission for this.';
  if (status === 404) return 'That candidate no longer exists.';
  return `The live-review service answered ${status}.`;
}
