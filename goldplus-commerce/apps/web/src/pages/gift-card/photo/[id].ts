import type { APIRoute } from 'astro';
import { apiBase } from '../../../lib/api';
import { isPhotoId } from '../../../lib/giftCardPhoto';

/**
 * 0201: a gift card's photo, served from the shop's own address so the card page (img-src 'self') and the share
 * image's canvas (which a cross-origin picture would taint) can both use it. The random id is the permission.
 * Sent as the storefront's own call (no visitor address): an admin page showing a hundred thumbnails must not
 * spend one visitor's lookup budget, and a 122-bit id is not something a limiter needs to protect.
 */
export const GET: APIRoute = async ({ params }) => {
  const id = String(params.id ?? '');
  if (!isPhotoId(id)) return new Response('Not found', { status: 404 });
  try {
    const upstream = await fetch(`${apiBase}/commerce/gift-cards/photos/${id}`, { signal: AbortSignal.timeout(8000) });
    if (!upstream.ok) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
    // Streamed through, not held in the storefront's memory.
    const length = upstream.headers.get('content-length');
    return new Response(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg', ...(length ? { 'Content-Length': length } : {}),
        'Cache-Control': 'private, max-age=3600', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('Unavailable', { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
};
