import type { APIRoute } from 'astro';
import { apiBase } from '../../lib/api';

/** 0209: a published review's photo, from the shop's own address (img-src 'self'). The API serves only published ones. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const GET: APIRoute = async ({ params }) => {
  const id = String(params.id ?? '');
  if (!UUID.test(id)) return new Response('Not found', { status: 404 });
  try {
    const upstream = await fetch(`${apiBase}/commerce/reviews/photos/${id}`, { signal: AbortSignal.timeout(8000) });
    if (!upstream.ok) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    const length = upstream.headers.get('content-length');
    return new Response(upstream.body, { status: 200, headers: { 'Content-Type': 'image/jpeg', ...(length ? { 'Content-Length': length } : {}), 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
  } catch {
    return new Response('Unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
};
