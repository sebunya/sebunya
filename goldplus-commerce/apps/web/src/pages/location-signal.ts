import type { APIRoute } from 'astro';
import { sendLocationSignal } from '../lib/locationSignals';
import { readBodyCapped } from '../lib/boundedBody';

/**
 * Same-origin relay for the location picker's signals ("Locate me" offer chosen or missed): the browser cannot
 * read the httpOnly visit cookie, so this page adds the visitor's own token server-side. Small JSON only, read with a
 * byte cap (never buffered whole); the API validates every field. A "Locate me" pin's coordinates are purged at the
 * pin retention (privacy page: 180 days).
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const read = await readBodyCapped(request, 1000);
  if (!read.ok) return new Response(null, { status: read.reason === 'TOO_LARGE' ? 413 : 400 });
  const text = read.text;
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }
  if (!body || typeof body !== 'object') return new Response(null, { status: 400 });
  await sendLocationSignal(body as Record<string, unknown>, (locals as { gpVisit?: string }).gpVisit, request);
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
};
