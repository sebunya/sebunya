import type { APIRoute } from 'astro';
import { sendLocationSignal } from '../lib/locationSignals';

/**
 * Same-origin relay for the location picker's signals ("Locate me" offer chosen or missed): the browser cannot
 * read the httpOnly visit cookie, so this page adds the visitor's own token server-side. Small JSON only; the API
 * validates every field and stores no coordinates.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const text = await request.text().catch(() => '');
  if (text.length > 1000) return new Response(null, { status: 413 });
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
