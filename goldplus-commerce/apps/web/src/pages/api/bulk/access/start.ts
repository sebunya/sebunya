import type { APIRoute } from 'astro';
import { apiBase } from '../../../../lib/api';
import { readBodyCapped } from '../../../../lib/boundedBody';
import { checkRequestOrigin, CROSS_SITE_MESSAGE } from '../../../../lib/requestOrigin';
import { BULK_ACCESS_COOKIE, readAccessCookie } from '../../../../lib/bulkAccess';

/**
 * Same-origin relay for the phone the buyer typed to see bulk prices.
 * First use of the number: the API answers with a visit-only token, kept in a
 * browser-session httpOnly cookie (no expiry: it ends when the browser closes);
 * the browser gets only { method, maskedPhone }. A number used before: the API
 * texts a code and /api/bulk/access/verify finishes.
 */
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const POST: APIRoute = async ({ request, cookies }) => {
  const origin = checkRequestOrigin(request, import.meta.env as unknown as Record<string, string | undefined>);
  if (!origin.allowed) return json(403, { success: false, error: { code: 'CROSS_SITE', message: CROSS_SITE_MESSAGE } });
  const read = await readBodyCapped(request, 1024);
  let phone = '';
  try { phone = String((JSON.parse(read.ok ? read.text : '{}') as { phone?: unknown }).phone ?? '').trim().slice(0, 32); } catch { phone = ''; }
  try {
    const upstream = await fetch(`${apiBase}/quotes/price-access/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(request.headers.get('x-forwarded-for') ? { 'x-forwarded-for': request.headers.get('x-forwarded-for') as string } : {}),
      },
      body: JSON.stringify({ phone }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = (await upstream.json().catch(() => null)) as
      | { success?: boolean; data?: { method?: unknown; maskedPhone?: unknown; token?: unknown } }
      | null;
    if (!payload) return json(502, { success: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Try again in a minute.' } });
    if (payload.success && payload.data?.method === 'first_visit') {
      const token = readAccessCookie(typeof payload.data.token === 'string' ? payload.data.token : null);
      if (!token) return json(502, { success: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Try again in a minute.' } });
      cookies.set(BULK_ACCESS_COOKIE, token, { path: '/', sameSite: 'lax', httpOnly: true, secure: import.meta.env.PROD });
      return json(200, { success: true, data: { method: 'first_visit', maskedPhone: String(payload.data.maskedPhone ?? '') } });
    }
    if (payload.success) return json(200, { success: true, data: { method: 'code', maskedPhone: String(payload.data?.maskedPhone ?? '') } });
    return json(upstream.status, payload);
  } catch {
    return json(502, { success: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'We could not send a code just now. Try again in a minute.' } });
  }
};
