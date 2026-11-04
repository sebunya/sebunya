import type { AstroCookies } from 'astro';
import { apiBase } from './api';

/**
 * Save for later without an account (Baymard P3/C6, docs/ux/BAYMARD.md). A guest's saved products live in one cookie on
 * the device: product ids only, nothing about the person. When the shopper signs in or registers, the list is moved into
 * the account (POST /account/saved per id) and the cookie is cleared, so what they saved before the account is not lost.
 */
export const GUEST_SAVED_COOKIE = 'gp_saved';
export const GUEST_SAVED_MAX = 24;
export const GUEST_SAVED_MAX_AGE = 60 * 60 * 24 * 180;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseGuestSaved(raw: string | undefined | null): string[] {
  if (!raw) return [];
  try {
    const list = JSON.parse(decodeURIComponent(raw));
    if (!Array.isArray(list)) return [];
    const out: string[] = [];
    for (const id of list) {
      if (typeof id === 'string' && UUID.test(id) && !out.includes(id.toLowerCase())) out.push(id.toLowerCase());
      if (out.length >= GUEST_SAVED_MAX) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function readGuestSaved(cookies: AstroCookies): string[] {
  return parseGuestSaved(cookies.get(GUEST_SAVED_COOKIE)?.value);
}

export function writeGuestSaved(cookies: AstroCookies, ids: readonly string[], secure: boolean): void {
  const list = ids.slice(-GUEST_SAVED_MAX);
  if (list.length === 0) {
    cookies.delete(GUEST_SAVED_COOKIE, { path: '/' });
    return;
  }
  cookies.set(GUEST_SAVED_COOKIE, encodeURIComponent(JSON.stringify(list)), {
    path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: GUEST_SAVED_MAX_AGE,
  });
}

/** The list with one id added (newest last) or removed. */
export function toggleGuestSaved(ids: readonly string[], productId: string, op: 'add' | 'remove'): string[] {
  const id = productId.toLowerCase();
  const without = ids.filter((x) => x !== id);
  return op === 'add' ? [...without, id] : without;
}

/**
 * Move the device's saved list into the signed-in account, then forget the cookie. Best effort: a failed call keeps
 * the cookie for the next sign-in rather than losing the item. Returns how many were moved.
 */
export async function mergeGuestSavedIntoAccount(cookies: AstroCookies, token: string, headers: Record<string, string> = {}): Promise<number> {
  const ids = readGuestSaved(cookies);
  if (ids.length === 0) return 0;
  let moved = 0;
  for (const productId of ids) {
    const ok = await fetch(`${apiBase}/account/saved`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers },
      body: JSON.stringify({ productId }),
      signal: AbortSignal.timeout(3000),
    }).then((r) => r.ok || r.status === 409).catch(() => false);
    if (ok) moved += 1;
  }
  if (moved === ids.length) cookies.delete(GUEST_SAVED_COOKIE, { path: '/' });
  return moved;
}
