import type { MiddlewareHandler } from 'hono';
import { timingSafeEqual } from 'node:crypto';

/**
 * A product's floor (Price A) is the lowest price a discount may ever reach.
 * The storefront's SSR needs it to compute sale prices; a browser must never
 * see it — it tells anyone how far we will go down (owner, 2026-09-18).
 *
 * The web container calls the API directly (INTERNAL_API_ORIGIN) and sends
 * `X-GoldPlus-Internal-Key: <INTERNAL_API_KEY>`. Every other caller — the
 * public api.shopgoldplus.com host, a browser — gets JSON with every
 * `floorPriceUgx` key removed, whichever route produced it. Admin routes are
 * permission-guarded and keep it (the product editor edits it).
 *
 * Fails closed: no key configured means NOBODY is internal, so the floor is
 * stripped everywhere and the storefront treats products as not discountable.
 */
export const INTERNAL_KEY_HEADER = 'x-goldplus-internal-key';
const FIELD = 'floorPriceUgx';

export function isInternalCaller(provided: string | undefined, expected: string | undefined): boolean {
  if (!provided || !expected || expected.length < 32) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function stripFloor(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripFloor);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k !== FIELD) out[k] = stripFloor(v);
    }
    return out;
  }
  return value;
}

export const floorPriceRedaction = (): MiddlewareHandler => async (c, next) => {
  await next();
  if (c.req.path.startsWith('/admin')) return;
  if (isInternalCaller(c.req.header(INTERNAL_KEY_HEADER), process.env.INTERNAL_API_KEY)) return;
  const type = c.res.headers.get('content-type') ?? '';
  if (!type.includes('application/json')) return;
  const text = await c.res.clone().text();
  if (!text.includes(`"${FIELD}"`)) return;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return;
  }
  const headers = new Headers(c.res.headers);
  headers.delete('content-length');
  headers.delete('etag');
  c.res = new Response(JSON.stringify(stripFloor(body)), { status: c.res.status, headers });
};
