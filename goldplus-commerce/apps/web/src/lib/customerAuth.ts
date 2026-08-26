import type { AstroCookies } from 'astro';
import { apiBase } from './api';

/**
 * Context-aware origin from api.ts. This module only ever runs server side (it
 * reads AstroCookies), so resolving the public origin here meant every
 * "is this shopper signed in?" check left the box and came back as a Cloudflare
 * 403 challenge page, silently downgrading real customers to guests.
 */
const API_BASE = apiBase;

/**
 * The one place the storefront decides whether a real customer is signed in.
 *
 * A signed USER checkout intent is NOT a substitute for a live session. The
 * intent proves "this browser was issued an identity"; only the session proves
 * "this person is still authenticated". Without this distinction a customer who
 * logged out would keep transacting as their former self for the remaining life
 * of the cookie, because the intent alone still verifies.
 *
 * The session token is never inspected here beyond forwarding it — signature
 * verification belongs to the API, which owns the signing key.
 */
export interface AuthenticatedCustomer {
  userId: string;
  /** The credential to forward to the API. Never logged. */
  apiCredential: string;
}

export const SESSION_COOKIE = 'goldplus_session';

export async function resolveAuthenticatedCustomer(
  cookies: AstroCookies,
): Promise<AuthenticatedCustomer | null> {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  try {
    // Asks the API who this token belongs to. The storefront deliberately does
    // not verify the signature itself: duplicating that logic in a second place
    // is how the two drift apart, and only one of them holds the key.
    const res = await fetch(`${API_BASE}/account/me`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as
      | { success?: boolean; data?: { id?: string } }
      | null;
    const userId = json?.success ? json.data?.id : undefined;
    if (!userId) return null;
    return { userId, apiCredential: token };
  } catch {
    // An unreachable API means "cannot confirm authentication", which must
    // degrade to guest — never to "authenticated as whoever the cookie claims".
    return null;
  }
}

export async function resolveAuthenticatedUserId(cookies: AstroCookies): Promise<string | null> {
  return (await resolveAuthenticatedCustomer(cookies))?.userId ?? null;
}
