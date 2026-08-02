import type { APIRoute } from 'astro';
import { readSessionToken } from '../../../../lib/session';

/**
 * Same-origin proxy for the Measurement Control Tower's interactive calls.
 *
 * WHY THIS EXISTS
 * Four admin measurement pages made client-side calls to the API with
 * `Authorization: Bearer localStorage.getItem('gp_auth_token')` — a token
 * nothing in the codebase ever sets. Every refresh, DLQ replay and audit
 * lookup silently sent an unauthenticated request and failed. The session
 * actually lives in an HttpOnly cookie the page scripts cannot (and must
 * not) read, so the fix is a server-side hop: the browser calls this
 * same-origin endpoint with its cookie, and the Astro server attaches the
 * bearer token out of the client's reach.
 *
 * The path is an ALLOWLIST, not a general forwarder: only the exact
 * measurement endpoints these pages use may be reached, each with its own
 * method, so this cannot become an SSRF or a generic authenticated relay.
 */

const API_BASE = (import.meta.env.PUBLIC_API_BASE_URL as string | undefined) ?? 'http://localhost:3000';

interface AllowedRoute {
  method: 'GET' | 'POST';
  pattern: RegExp;
  /** Query parameters forwarded when present; everything else is dropped. */
  queryAllowlist: string[];
}

const ALLOWED: AllowedRoute[] = [
  { method: 'GET', pattern: /^overview$/, queryAllowlist: [] },
  { method: 'GET', pattern: /^match-quality$/, queryAllowlist: ['days'] },
  { method: 'GET', pattern: /^dlq$/, queryAllowlist: ['limit'] },
  { method: 'GET', pattern: /^consent-audit$/, queryAllowlist: ['limit'] },
  { method: 'GET', pattern: /^attribution\/[A-Za-z0-9-]{1,64}$/, queryAllowlist: [] },
  { method: 'POST', pattern: /^dlq\/[A-Za-z0-9-]{1,64}\/replay$/, queryAllowlist: [] },
];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function proxy(request: Request, params: Record<string, string | undefined>, method: 'GET' | 'POST'): Promise<Response> {
  const token = readSessionToken(request);
  if (!token) {
    return json(401, { success: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in again.' } });
  }

  const path = params.path ?? '';
  const route = ALLOWED.find((entry) => entry.method === method && entry.pattern.test(path));
  if (!route) {
    return json(404, { success: false, error: { code: 'NOT_PROXIED', message: 'This endpoint is not proxied.' } });
  }

  const upstream = new URL(`${API_BASE}/admin/measurement/${path}`);
  const incoming = new URL(request.url);
  for (const key of route.queryAllowlist) {
    const value = incoming.searchParams.get(key);
    if (value !== null && /^[A-Za-z0-9-]{1,32}$/.test(value)) upstream.searchParams.set(key, value);
  }

  try {
    const response = await fetch(upstream, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return json(502, { success: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'The measurement API did not answer.' } });
  }
}

export const GET: APIRoute = ({ request, params }) => proxy(request, params, 'GET');
export const POST: APIRoute = ({ request, params }) => proxy(request, params, 'POST');
