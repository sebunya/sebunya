import type { AstroCookies } from 'astro';
import { apiBase } from './api';
import { readSessionToken } from './session';
import { placeFromPayload, readChosenPlace, writeChosenPlace, knownDeliveryPlace, type DeliveryPlace } from './deliveryPlace';

/**
 * Server-to-server location signals (0193). The visitor's own signed visit token and session go with each call so
 * the API can apply THEIR consent; the browser never sees either. Every call is best-effort and time-boxed: a
 * signal must never slow or break a page.
 */
export function signalHeaders(visit: string | null | undefined, request: Request): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (visit) h['x-gp-visit'] = visit;
  const session = readSessionToken(request);
  if (session) h.Authorization = `Bearer ${session}`;
  return h;
}

export async function sendLocationSignal(body: Record<string, unknown>, visit: string | null | undefined, request: Request): Promise<void> {
  try {
    await fetch(`${apiBase}/locations/signals`, {
      method: 'POST',
      headers: signalHeaders(visit, request),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(1500),
    });
  } catch {
    /* a signal is never worth a failed page */
  }
}

/** Set after a server lookup found no "Deliver to": the next lookup waits a day. */
export const DELIVER_TO_CHECKED_COOKIE = 'gp_deliver_to_checked';

/**
 * "Deliver to" for this visitor: this device first (cookie, then last checkout), else what they set on another
 * device when signed in (kept on their profile, 0193) — which is then remembered here too. A miss is remembered for
 * a day, so a visitor with no area costs one lookup a day, not one per page.
 */
export async function resolveDeliveryPlace(
  ctx: { cookies: AstroCookies; request: Request; visit: string | null | undefined; secure: boolean },
): Promise<DeliveryPlace | null> {
  const local = knownDeliveryPlace(ctx.cookies, ctx.request);
  if (local) return local;
  if (!readSessionToken(ctx.request) && !ctx.visit) return null;
  if (ctx.cookies.get(DELIVER_TO_CHECKED_COOKIE)?.value) return null;
  try {
    // Short: this runs in middleware before the page renders, at most once a day for a visitor without an area.
    const res = await fetch(`${apiBase}/locations/deliver-to`, { headers: signalHeaders(ctx.visit, ctx.request), signal: AbortSignal.timeout(700) });
    const json: any = res.ok ? await res.json().catch(() => null) : null;
    const p = placeFromPayload(json?.data?.place ?? null, 'account');
    if (p) {
      if (!readChosenPlace(ctx.cookies)) writeChosenPlace(ctx.cookies, p, ctx.secure);
      return p;
    }
  } catch {
    /* this device's answer stands */
    return null;
  }
  try {
    ctx.cookies.set(DELIVER_TO_CHECKED_COOKIE, '1', { path: '/', maxAge: 60 * 60 * 24, httpOnly: true, sameSite: 'lax', secure: ctx.secure });
  } catch { /* a convenience */ }
  return null;
}
