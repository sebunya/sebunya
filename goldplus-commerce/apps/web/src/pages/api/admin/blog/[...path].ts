import type { APIRoute } from 'astro';
import { readSessionToken } from '../../../../lib/session';
import { apiBase } from '../../../../lib/api';

/**
 * Same-origin proxy for the article editor's writes.
 *
 * The admin session lives in an HttpOnly cookie the editor's script cannot (and
 * must not) read, so the browser calls this same-origin endpoint with its
 * cookie and the Astro server attaches the bearer token out of the client's
 * reach.
 *
 * The path is an ALLOWLIST, not a general forwarder: only the blog endpoints
 * the editor uses may be reached, each with its own method, so this cannot
 * become an SSRF or a generic authenticated relay into the whole admin API.
 */
// The canonical resolver decides the origin (internal container for SSR).
// Duplicating that resolution here is how a server-side call ends up pointed at
// our own PUBLIC host, which Cloudflare answers with a 403 challenge.
const API_BASE = apiBase;

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';

const ALLOWED: Array<{ method: 'POST' | 'PUT' | 'DELETE'; pattern: RegExp }> = [
  { method: 'POST', pattern: new RegExp('^$') },
  { method: 'PUT', pattern: new RegExp(`^${UUID}$`) },
  { method: 'POST', pattern: new RegExp(`^${UUID}/publish$`) },
  { method: 'POST', pattern: new RegExp(`^${UUID}/unpublish$`) },
  { method: 'DELETE', pattern: new RegExp(`^${UUID}$`) },
];

/** An article body is long-form prose; anything past this is not an article. */
const MAX_BODY_BYTES = 200_000;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function proxy(request: Request, params: Record<string, string | undefined>, method: 'POST' | 'PUT' | 'DELETE'): Promise<Response> {
  const token = readSessionToken(request);
  if (!token) {
    return json(401, { success: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in again.' } });
  }

  const path = params.path ?? '';
  if (!ALLOWED.some((entry) => entry.method === method && entry.pattern.test(path))) {
    return json(404, { success: false, error: { code: 'NOT_PROXIED', message: 'This endpoint is not proxied.' } });
  }

  let body: string | undefined;
  if (method !== 'DELETE') {
    body = await request.text();
    if (body.length > MAX_BODY_BYTES) {
      return json(413, { success: false, error: { code: 'TOO_LARGE', message: 'That article is too long to save.' } });
    }
  }

  try {
    const response = await fetch(`${API_BASE}/admin/blog${path ? `/${path}` : ''}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    return new Response(await response.text(), {
      status: response.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return json(502, { success: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'The API did not answer.' } });
  }
}

export const POST: APIRoute = ({ request, params }) => proxy(request, params, 'POST');
export const PUT: APIRoute = ({ request, params }) => proxy(request, params, 'PUT');
export const DELETE: APIRoute = ({ request, params }) => proxy(request, params, 'DELETE');
