import type { APIRoute } from 'astro';
import { apiBase } from '../../../../lib/api';
import { readBodyCapped } from '../../../../lib/boundedBody';
import { checkRequestOrigin, CROSS_SITE_MESSAGE } from '../../../../lib/requestOrigin';

/** Same-origin relay: text a code to the phone the buyer typed, to unlock bulk prices. */
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const POST: APIRoute = async ({ request }) => {
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
    const payload = await upstream.json().catch(() => null);
    return json(upstream.status, payload ?? { success: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'We could not send a code just now. Try again in a minute.' } });
  } catch {
    return json(502, { success: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'We could not send a code just now. Try again in a minute.' } });
  }
};
