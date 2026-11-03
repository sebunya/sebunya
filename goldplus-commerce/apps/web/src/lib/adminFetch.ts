/**
 * Admin page → API calls that cannot throw a raw 500 or hang the page.
 *
 * A network failure (API restarting: ECONNREFUSED) or a stall used to surface as
 * an unhandled 500 with nothing saying whether anything was stored. Every call
 * here is bounded by a timeout and answers either "the API answered with this
 * status and body" or "unreachable", so the page can say which.
 */
export type AdminFetchOutcome =
  | { kind: 'answered'; status: number; json: any }
  | { kind: 'unreachable' };

export const ADMIN_FETCH_TIMEOUT_MS = 15_000;

export async function adminFetchJson(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = ADMIN_FETCH_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch,
): Promise<AdminFetchOutcome> {
  try {
    const res = await fetchImpl(url, { ...init, signal: init.signal ?? AbortSignal.timeout(timeoutMs) });
    const json = await res.json().catch(() => null);
    return { kind: 'answered', status: res.status, json };
  } catch {
    return { kind: 'unreachable' };
  }
}

export type PhotoUploadResult =
  | { ok: true; stored: number; note: string | null }
  | { ok: false; message: string };

/**
 * What a product-photo upload actually did. `success` alone is not enough: only
 * the API's `stored` count says how many photos were kept, and its `message`
 * says why the rest were refused. Nothing stored is an error, never a green
 * "Photos saved (0)"; a missing `stored` is never filled in with the files sent.
 */
export function photoUploadResult(outcome: AdminFetchOutcome, filesSent: number): PhotoUploadResult {
  if (outcome.kind === 'unreachable') {
    return { ok: false, message: 'The API did not answer, so it is not known whether the photos were stored. Reload the page to check.' };
  }
  const json = outcome.json;
  const apiMessage = typeof json?.message === 'string' ? json.message
    : typeof json?.error?.message === 'string' ? json.error.message : null;
  if (!json?.success) {
    return { ok: false, message: apiMessage ?? `The photos were not saved (HTTP ${outcome.status}).` };
  }
  const stored = typeof json.stored === 'number' && Number.isFinite(json.stored)
    ? json.stored
    : Array.isArray(json.data) ? json.data.filter((o: any) => o?.outcome === 'ASSIGNED' || o?.outcome === 'COVER').length : null;
  if (stored === null) {
    return { ok: false, message: 'The API did not say how many photos it stored. Reload the page to check.' };
  }
  if (stored <= 0) {
    return { ok: false, message: apiMessage ?? 'None of the photos were stored.' };
  }
  return { ok: true, stored, note: stored < filesSent ? apiMessage : null };
}
