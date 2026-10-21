import type { APIRoute } from 'astro';
import { apiBase } from '../../../lib/api';

/**
 * 0201: a gift card's photo, served from the shop's own address so the card page (img-src 'self') and the share
 * image's canvas (which a cross-origin picture would taint) can both use it. The random id is the permission.
 */
export const GET: APIRoute = async ({ params }) => {
  const id = String(params.id ?? '');
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('Not found', { status: 404 });
  try {
    const upstream = await fetch(`${apiBase}/commerce/gift-cards/photos/${id}`, { signal: AbortSignal.timeout(8000) });
    if (!upstream.ok) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    return new Response(await upstream.arrayBuffer(), {
      status: 200,
      headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=3600', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch {
    return new Response('Unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
};
