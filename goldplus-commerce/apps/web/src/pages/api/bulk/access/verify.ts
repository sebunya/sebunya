import type { APIRoute } from 'astro';
import { apiBase } from '../../../../lib/api';
import { readBodyCapped } from '../../../../lib/boundedBody';
import { checkRequestOrigin, CROSS_SITE_MESSAGE } from '../../../../lib/requestOrigin';
import { BULK_ACCESS_COOKIE, readAccessCookie } from '../../../../lib/bulkAccess';

/**
 * Same-origin relay: check the code. On success the token goes into an httpOnly
 * cookie for 30 days and the browser gets only the masked phone; the page then
 * reloads and is rendered with bulk prices.
 */
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const POST: APIRoute = async ({ request, cookies }) => {
  const origin = checkRequestOrigin(request, import.meta.env as unknown as Record<string, string | undefined>);
  if (!origin.allowed) return json(403, { success: false, error: { code: 'CROSS_SITE', message: CROSS_SITE_MESSAGE } });
  const read = await readBodyCapped(request, 1024);
  let body: { phone?: unknown; code?: unknown } = {};
  try { body = JSON.parse(read.ok ? read.text : '{}'); } catch { body = {}; }
  let upstream: Response;
  try {
    upstream = await fetch(`${apiBase}/quotes/price-access/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(request.headers.get('x-forwarded-for') ? { 'x-forwarded-for': request.headers.get('x-forwarded-for') as string } : {}),
      },
      body: JSON.stringify({ phone: String(body.phone ?? '').trim().slice(0, 32), code: String(body.code ?? '').trim().slice(0, 12) }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return json(502, { success: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'We could not check the code just now. Try again in a minute.' } });
  }
  const payload = (await upstream.json().catch(() => null)) as
    | { success?: boolean; data?: { token?: unknown; expiresAt?: unknown; maskedPhone?: unknown }; error?: unknown }
    | null;
  const token = payload?.success ? readAccessCookie(typeof payload.data?.token === 'string' ? payload.data.token : null) : null;
  if (!token) {
    return json(upstream.ok ? 502 : upstream.status, payload?.success ? { success: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'Try again in a minute.' } } : payload);
  }
  const expires = new Date(String(payload!.data!.expiresAt ?? ''));
  cookies.set(BULK_ACCESS_COOKIE, token, {
    path: '/',
    expires: Number.isFinite(expires.getTime()) ? expires : new Date(Date.now() + 30 * 86_400_000),
    sameSite: 'lax',
    httpOnly: true,
    secure: import.meta.env.PROD,
  });
  return json(200, { success: true, data: { maskedPhone: String(payload!.data!.maskedPhone ?? '') } });
};
