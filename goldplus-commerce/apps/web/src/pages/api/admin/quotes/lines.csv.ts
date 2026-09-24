import type { APIRoute } from 'astro';
import { readSessionToken } from '../../../../lib/session';
import { apiBase } from '../../../../lib/api';

/**
 * Same-origin download proxy for every bulk quote line as CSV. Reads the
 * HttpOnly admin session, attaches the bearer server-side and streams the
 * API's file (formula-safe cells, quotes.manage). One fixed upstream path.
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
    const upstream = await fetch(`${apiBase}/admin/quote-requests/lines.csv`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'text/csv; charset=utf-8',
        'Content-Disposition': upstream.headers.get('Content-Disposition') ?? 'attachment; filename="quote-request-lines.csv"',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return new Response(JSON.stringify({ success: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'The quote API did not answer.' } }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
