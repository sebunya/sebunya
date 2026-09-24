import type { APIRoute } from 'astro';
import { readSessionToken } from '../../../../lib/session';
import { apiBase } from '../../../../lib/api';

/**
 * Same-origin download proxy for the gallery reconciliation CSV.
 *
 * The page used to link the browser straight at `${apiBase}/…csv`. During SSR
 * apiBase is the INTERNAL API origin (http://api:3000 in production), which a
 * browser cannot reach, and the API authenticates by Bearer only, which a link
 * cannot send. This reads the HttpOnly session cookie, attaches the bearer
 * server-side and streams the CSV. One fixed upstream path: never a relay.
 */
export const GET: APIRoute = async ({ request }) => {
  const token = readSessionToken(request);
  if (!token) {
    return new Response(JSON.stringify({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in again.' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const upstream = await fetch(`${apiBase}/admin/media/gallery-queue/reconciliation.csv`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'text/csv; charset=utf-8',
        'Content-Disposition': upstream.headers.get('Content-Disposition') ?? 'attachment; filename="gallery-reconciliation.csv"',
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
