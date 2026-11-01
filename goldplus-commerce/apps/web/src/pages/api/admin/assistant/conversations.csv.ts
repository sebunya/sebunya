import type { APIRoute } from 'astro';
import { readSessionToken } from '../../../../lib/session';
import { apiBase } from '../../../../lib/api';

/**
 * Same-origin download proxy for Goldie's conversations as CSV (the inbox's
 * current filters, newest 200). Reads the HttpOnly admin session, attaches the
 * bearer server-side and streams the API's file (formula-safe cells,
 * customers.data.view). Only the known filter names are forwarded.
 */
export const prerender = false;
const FILTERS = ['channel', 'outcome', 'mood', 'topic', 'q', 'from', 'to'];

export const GET: APIRoute = async ({ request, url }) => {
  const token = readSessionToken(request);
  if (!token) {
    return new Response(JSON.stringify({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in again.' } }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  const params = new URLSearchParams();
  for (const k of FILTERS) { const v = url.searchParams.get(k); if (v) params.set(k, v.slice(0, 80)); }
  try {
    const upstream = await fetch(`${apiBase}/admin/assistant/conversations.csv?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'text/csv; charset=utf-8',
        'Content-Disposition': upstream.headers.get('Content-Disposition') ?? 'attachment; filename="goldie-conversations.csv"',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return new Response(JSON.stringify({ success: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'The API did not answer.' } }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
};
