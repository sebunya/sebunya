import type { APIRoute } from 'astro';
import { readSessionToken } from '../../../../../lib/session';
import { apiBase } from '../../../../../lib/api';

/**
 * Same-origin download proxy for a media import's results CSV. The page used to
 * link the browser at the internal API origin with no bearer (dead in
 * production). Reads the session cookie, validates the id, streams the CSV from
 * one fixed upstream path — never a generic relay.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET: APIRoute = async ({ request, params }) => {
  const token = readSessionToken(request);
  if (!token) {
    return new Response(JSON.stringify({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in again.' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const id = params.id ?? '';
  if (!UUID_RE.test(id)) {
    return new Response(JSON.stringify({ success: false, error: { code: 'BAD_ID', message: 'Invalid import id.' } }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const upstream = await fetch(`${apiBase}/admin/media-imports/${id}/results.csv`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'text/csv; charset=utf-8',
        'Content-Disposition': upstream.headers.get('Content-Disposition') ?? `attachment; filename="media-import-${id}-results.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return new Response(JSON.stringify({ success: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'The media API did not answer.' } }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
