import type { APIRoute } from 'astro';
import { readSessionToken } from '../../../../lib/session';
import { apiBase } from '../../../../lib/api';
import { readBodyCapped } from '../../../../lib/boundedBody';

/**
 * Same-origin proxy for the Care Desk's "Alert me on this phone": the browser hands over its push subscription
 * (or asks to drop it); the admin session's bearer is attached here, never exposed to the page.
 */
export const prerender = false;
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function forward(request: Request, method: 'PUT' | 'DELETE') {
  const token = readSessionToken(request);
  if (!token) return json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in again.' } }, 401);
  // Capped while reading (bytes, not UTF-16 units): a chunked multi-GB body is cut off, never buffered.
  const read = await readBodyCapped(request, 4000);
  if (!read.ok) return json({ success: false }, read.reason === 'TOO_LARGE' ? 413 : 400);
  const body = read.text;
  try {
    const res = await fetch(`${apiBase}/admin/care/push-subscriptions`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body, signal: AbortSignal.timeout(8000) });
    return new Response(await res.text(), { status: res.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  } catch {
    return json({ success: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'The system did not answer.' } }, 502);
  }
}

export const POST: APIRoute = ({ request }) => forward(request, 'PUT');
export const DELETE: APIRoute = ({ request }) => forward(request, 'DELETE');
