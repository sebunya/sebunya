import type { AstroCookies } from 'astro';

/**
 * What a guest typed at their last completed checkout, kept in an httpOnly
 * cookie on their own device (never readable by page scripts, never sent to
 * anyone else). Checkout writes it; every other form reads it so a returning
 * buyer confirms instead of retyping: tracking an order from the SMS link,
 * rating it, asking for a quote, applying as a dealer.
 *
 * The cookie used to be scoped to /checkout, so no other page could see it.
 * It is now written for the whole site; the old /checkout-scoped copy is
 * removed when the new one is written.
 */
export const GUEST_MEMORY_COOKIE = 'gp_checkout_prefill';
export const GUEST_MEMORY_MAX_AGE = 60 * 60 * 24 * 180;

export interface GuestMemory { name?: string; email?: string; phone?: string; locationJson?: string; deliveryAddress?: string }

export function readGuestMemory(cookies: AstroCookies): GuestMemory {
  const out: GuestMemory = {};
  try {
    const raw = cookies.get(GUEST_MEMORY_COOKIE)?.value;
    if (!raw) return out;
    const parsed = JSON.parse(decodeURIComponent(raw));
    if (!parsed || typeof parsed !== 'object') return out;
    for (const k of ['name', 'email', 'phone', 'locationJson', 'deliveryAddress'] as const) {
      if (typeof parsed[k] === 'string' && parsed[k].length > 0 && parsed[k].length <= 600) out[k] = parsed[k];
    }
  } catch { /* stale or corrupt cookie = no memory */ }
  return out;
}

export function writeGuestMemory(cookies: AstroCookies, m: GuestMemory, secure: boolean): void {
  try {
    cookies.delete(GUEST_MEMORY_COOKIE, { path: '/checkout' });
    cookies.set(GUEST_MEMORY_COOKIE, encodeURIComponent(JSON.stringify(m)), { path: '/', maxAge: GUEST_MEMORY_MAX_AGE, httpOnly: true, sameSite: 'lax', secure });
  } catch { /* memory is a convenience */ }
}

/** The contact a guest used at checkout, for an order lookup: phone first (what most people use), else email. */
export const rememberedContact = (m: GuestMemory): string => m.phone || m.email || '';
