import type { APIRoute } from 'astro';
import { readSessionToken } from '../../../../lib/session';
import { apiBase } from '../../../../lib/api';
import { CHANNEL_REPORT_MODELS } from '../../../../lib/channelReport';

/**
 * Same-origin download proxy for the weekly channel report as CSV. Reads the
 * HttpOnly admin session, attaches the bearer server-side and streams the
 * API's file (formula-safe cells, attribution.read). One fixed upstream path;
 * only a known model and week count are forwarded.
 */
export const GET: APIRoute = async ({ request, url }) => {
  const token = readSessionToken(request);
  if (!token) {
    return new Response(JSON.stringify({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in again.' } }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const m = url.searchParams.get('model') ?? '';
  const model = CHANNEL_REPORT_MODELS.some((x) => x.value === m) ? m : 'last_click';
  const w = Number(url.searchParams.get('weeks'));
  const weeks = Number.isInteger(w) && w >= 1 && w <= 52 ? w : 12;
  try {
    const upstream = await fetch(`${apiBase}/admin/attribution/channel-report.csv?model=${encodeURIComponent(model)}&weeks=${weeks}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        'Content-Type': upstream.headers.get('Content-Type') ?? 'text/csv; charset=utf-8',
        'Content-Disposition': upstream.headers.get('Content-Disposition') ?? 'attachment; filename="channel-report.csv"',
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return new Response(JSON.stringify({ success: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'The attribution API did not answer.' } }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
