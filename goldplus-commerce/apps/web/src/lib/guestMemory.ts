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

/**
 * Read the memory. A device that checked out before 2026-10-13 may also hold an older copy scoped
 * to /checkout; on /checkout the browser then sends both, most specific path first, and
 * cookies.get() would return the stale one. With the request, the LAST copy (the site-wide one)
 * wins.
 */
export function readGuestMemory(cookies: AstroCookies, request?: Request): GuestMemory {
  const out: GuestMemory = {};
  try {
    let raw = cookies.get(GUEST_MEMORY_COOKIE)?.value;
    const header = request?.headers.get('cookie');
    if (header) {
      const all = header.split(/;\s*/).filter((c) => c.startsWith(`${GUEST_MEMORY_COOKIE}=`)).map((c) => c.slice(GUEST_MEMORY_COOKIE.length + 1));
      if (all.length) raw = all[all.length - 1];
    }
    if (!raw) return out;
    const parsed = JSON.parse(decodeURIComponent(raw));
    if (!parsed || typeof parsed !== 'object') return out;
    for (const k of ['name', 'email', 'phone', 'locationJson', 'deliveryAddress'] as const) {
      if (typeof parsed[k] === 'string' && parsed[k].length > 0 && parsed[k].length <= 600) out[k] = parsed[k];
    }
  } catch { /* stale or corrupt cookie = no memory */ }
  return out;
}

/** Write the memory for the whole site. (Astro keeps ONE pending change per cookie name, so the
 *  old /checkout-scoped copy cannot be deleted in the same response; readGuestMemory ignores it
 *  and "Not you?" deletes both.) */
export function writeGuestMemory(cookies: AstroCookies, m: GuestMemory, secure: boolean): void {
  try {
    cookies.set(GUEST_MEMORY_COOKIE, encodeURIComponent(JSON.stringify(m)), { path: '/', maxAge: GUEST_MEMORY_MAX_AGE, httpOnly: true, sameSite: 'lax', secure });
  } catch { /* memory is a convenience */ }
}

/** The Set-Cookie headers that forget this device's memory: both the site-wide copy and the old
 *  /checkout-scoped one. Raw headers, because Astro's cookie API would keep only the last of two
 *  changes to the same name. */
export function forgetGuestMemoryHeaders(): string[] {
  return ['/', '/checkout'].map((path) => `${GUEST_MEMORY_COOKIE}=; Path=${path}; Max-Age=0; HttpOnly; SameSite=Lax`);
}

export const hasGuestMemory = (m: GuestMemory): boolean => Boolean(m.name || m.phone || m.email);

/** The contact a guest used at checkout, for an order lookup: phone first (what most people use), else email. */
export const rememberedContact = (m: GuestMemory): string => m.phone || m.email || '';
