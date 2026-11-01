import type { APIRoute } from 'astro';
import { apiBase } from '../../../../lib/api';
import { readSessionToken } from '../../../../lib/session';

/** 0212: a proof-of-delivery photo, with the staff session. Never public. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET: APIRoute = async ({ params, request }) => {
  const id = String(params.id ?? '');
  const token = readSessionToken(request);
  if (!UUID.test(id) || !token) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  try {
    const upstream = await fetch(`${apiBase}/admin/fulfilment/delivery-photos/${id}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
    if (!upstream.ok) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    const length = upstream.headers.get('content-length');
    return new Response(upstream.body, { status: 200, headers: { 'Content-Type': 'image/jpeg', ...(length ? { 'Content-Length': length } : {}), 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff' } });
  } catch {
    return new Response('Unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
};
