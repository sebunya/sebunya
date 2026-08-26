import type { APIRoute } from 'astro';
import { apiBase } from '../../lib/api';

/**
 * Same-origin relay for a customer's battery request, so the browser never
 * needs the API origin and the abuse-control layer still sees one request per
 * submission. Single-purpose by construction: one fixed upstream path, a
 * bounded JSON body, nothing forwarded but the fields the finder collects.
 */
const FIELDS = ['queryText', 'brandText', 'deviceText', 'modelNumberText', 'batteryCodeText', 'contactName', 'contactPhone', 'notes'] as const;
const MAX: Record<(typeof FIELDS)[number], number> = {
  queryText: 200, brandText: 80, deviceText: 120, modelNumberText: 80, batteryCodeText: 120, contactName: 120, contactPhone: 32, notes: 1000,
};

export const POST: APIRoute = async ({ request }) => {
  const raw = await request.json().catch(() => null);
  if (!raw || typeof raw !== 'object') {
    return new Response(JSON.stringify({ success: false, error: { code: 'INVALID_BODY', message: 'Tell us the phone model or the battery code.' } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }
  const body: Record<string, unknown> = { source: (raw as Record<string, unknown>).source === 'PRODUCT_PAGE' ? 'PRODUCT_PAGE' : 'FINDER_NO_RESULT' };
  for (const field of FIELDS) {
    const value = (raw as Record<string, unknown>)[field];
    body[field] = typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX[field]) : null;
  }
  try {
    const upstream = await fetch(`${apiBase}/batteries/finder/requests`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(request.headers.get('x-gp-finder-session') ? { 'x-gp-finder-session': request.headers.get('x-gp-finder-session') as string } : {}),
        ...(request.headers.get('x-forwarded-for') ? { 'x-forwarded-for': request.headers.get('x-forwarded-for') as string } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    return new Response(await upstream.text(), { status: upstream.status, headers: { 'Content-Type': 'application/json' } });
  } catch {
    return new Response(JSON.stringify({ success: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'We could not record that just now.' } }), { status: 502, headers: { 'Content-Type': 'application/json' } });
  }
};
