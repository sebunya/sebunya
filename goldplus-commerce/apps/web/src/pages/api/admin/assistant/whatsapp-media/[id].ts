import type { APIRoute } from 'astro';
import { readSessionToken } from '../../../../../lib/session';
import { apiBase } from '../../../../../lib/api';

/** Same-origin view of a customer's WhatsApp photo / voice note for signed-in staff (the api checks permission). */
export const prerender = false;
export const GET: APIRoute = async ({ request, params }) => {
  const token = readSessionToken(request);
  const id = String(params.id ?? '');
  if (!token) return new Response('Sign in again.', { status: 401 });
  if (!/^\d{5,30}$/.test(id)) return new Response('Not found', { status: 404 });
  try {
    const res = await fetch(`${apiBase}/admin/assistant/whatsapp-media/${id}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    const headers = new Headers({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
    for (const h of ['content-type', 'content-disposition', 'content-security-policy']) { const v = res.headers.get(h); if (v) headers.set(h, v); }
    return new Response(res.body, { status: res.status, headers });
  } catch {
    return new Response('The system could not be reached.', { status: 502 });
  }
};
