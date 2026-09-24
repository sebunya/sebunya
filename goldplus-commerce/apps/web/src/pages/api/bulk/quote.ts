import type { APIRoute } from 'astro';
import { apiBase } from '../../../lib/api';
import { readBodyCapped } from '../../../lib/boundedBody';
import { checkRequestOrigin, CROSS_SITE_MESSAGE } from '../../../lib/requestOrigin';
import { BULK_RECEIPT_COOKIE, encodeBulkReceipt } from '../../../lib/bulkReceipt';

/**
 * Same-origin relay for a bulk quote request (docs/bulk-buying/DESIGN.md).
 *
 * One fixed upstream path, a bounded body, and only the fields the builder
 * collects: never a general relay. Product ids and quantities go through; no
 * price, name or code the browser holds is forwarded, because the API takes
 * those from the catalogue itself.
 *
 * On success the reference and phone are kept in an httpOnly cookie for an
 * hour so /bulk/submitted can look the request up and show its lines, without
 * a phone number ever sitting in a URL.
 */
const MAX_BODY_BYTES = 64 * 1024;
const TEXT_FIELDS = {
  idempotencyKey: 80,
  customerName: 100,
  businessName: 160,
  phone: 32,
  email: 255,
  buyerType: 20,
  deliveryDistrict: 80,
  neededBy: 10,
  notes: 2000,
} as const;
const MAX_LINES = 200;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export const POST: APIRoute = async ({ request, cookies }) => {
  const origin = checkRequestOrigin(request, import.meta.env as unknown as Record<string, string | undefined>);
  if (!origin.allowed) return json(403, { success: false, error: { code: 'CROSS_SITE', message: CROSS_SITE_MESSAGE } });

  const read = await readBodyCapped(request, MAX_BODY_BYTES);
  if (!read.ok) return json(413, { success: false, error: { code: 'TOO_LARGE', message: 'That list is too long. Split it into two requests.' } });
  let raw: Record<string, unknown> | null = null;
  try { raw = JSON.parse(read.text); } catch { raw = null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return json(400, { success: false, error: { code: 'BAD_JSON', message: 'Reload the page and try again.' } });
  }

  const body: Record<string, unknown> = {};
  for (const [field, max] of Object.entries(TEXT_FIELDS)) {
    const value = raw[field];
    body[field] = typeof value === 'string' ? value.trim().slice(0, max) : '';
  }
  body.lines = (Array.isArray(raw.lines) ? raw.lines : []).slice(0, MAX_LINES * 2).map((l) => ({
    productId: typeof (l as { productId?: unknown })?.productId === 'string' ? (l as { productId: string }).productId : '',
    quantity: Number((l as { quantity?: unknown })?.quantity),
  }));

  let upstream: Response;
  try {
    upstream = await fetch(`${apiBase}/quotes/bulk`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(request.headers.get('x-forwarded-for') ? { 'x-forwarded-for': request.headers.get('x-forwarded-for') as string } : {}),
      },
      body: JSON.stringify(body),
      // Safe to bound: the request carries an idempotency key, so a retry after
      // a timeout returns the request that landed instead of making a second.
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return json(502, { success: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'We could not reach our sales system. Your list is saved on this device. Try again in a minute.' } });
  }

  const payload = (await upstream.json().catch(() => null)) as
    | { success?: boolean; data?: { request?: { reference?: unknown } }; error?: unknown }
    | null;
  if (!payload) {
    return json(502, { success: false, error: { code: 'UPSTREAM_UNAVAILABLE', message: 'We could not reach our sales system. Try again in a minute.' } });
  }
  const reference = payload.success ? payload.data?.request?.reference : null;
  if (typeof reference === 'string' && reference) {
    cookies.set(BULK_RECEIPT_COOKIE, encodeBulkReceipt({ reference, phone: String(body.phone) }), {
      path: '/bulk',
      maxAge: 60 * 60,
      sameSite: 'lax',
      httpOnly: true,
      secure: import.meta.env.PROD,
    });
  }
  return json(upstream.status, payload);
};
