import type { APIRoute } from 'astro';
import { readSessionToken } from '../../../../../../lib/session';
import { apiBase } from '../../../../../../lib/api';

/**
 * Same-origin download proxy for the battery import error report.
 *
 * The API authenticates with `Authorization: Bearer` only, which a browser
 * download link cannot supply; this endpoint reads the HttpOnly session cookie,
 * attaches the bearer server-side and streams the CSV through. Single-purpose by
 * construction — a UUID-validated id into one fixed upstream path — the same
 * shape as the PIM error-report proxy: never a generic relay.
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
    const upstream = await fetch(`${apiBase}/admin/batteries/imports/${id}/error-report`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'text/csv; charset=utf-8',
        'Content-Disposition': upstream.headers.get('Content-Disposition') ?? `attachment; filename="battery-import-${id}-errors.csv"`,
      },
    });
  } catch {
    return new Response(JSON.stringify({ success: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'The battery API did not answer.' } }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
