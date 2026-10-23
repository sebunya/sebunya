import type { APIRoute } from 'astro';
import { readSessionToken } from '../../../../lib/session';
import { apiBase } from '../../../../lib/api';

/** Same-origin download of the marketing mix dataset (daily.csv + controls.csv as one zip). Fixed upstream path; only dates forwarded. */
export const GET: APIRoute = async ({ request, url }) => {
  const token = readSessionToken(request);
  if (!token) return new Response(JSON.stringify({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in again.' } }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  const day = /^\d{4}-\d{2}-\d{2}$/;
  const q = new URLSearchParams();
  for (const k of ['from', 'to']) { const v = url.searchParams.get(k); if (v && day.test(v)) q.set(k, v); }
  try {
    const upstream = await fetch(`${apiBase}/admin/measurement/mmm/export${q.size ? `?${q}` : ''}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000) });
    return new Response(upstream.body, { status: upstream.status, headers: { 'Content-Type': upstream.headers.get('Content-Type') ?? 'application/zip', 'Content-Disposition': upstream.headers.get('Content-Disposition') ?? 'attachment; filename="goldplus-mmm.zip"', 'Cache-Control': 'no-store' } });
  } catch {
    return new Response(JSON.stringify({ success: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'The measurement API did not answer.' } }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
};
