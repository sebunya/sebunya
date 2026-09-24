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

/**
 * How long a page waits to learn who is signed in. The middleware awaits this
 * on every document request, so without a bound a stalled API held every
 * signed-in page render for undici's default timeout. A timeout is UNKNOWN,
 * never "guest": see SessionCheck.
 */
export const SESSION_CHECK_TIMEOUT_MS = 1500;

/**
 * Three answers, not two. "The API said this token is not signed in" (401/403/404,
 * or no token at all) is GUEST. "We could not find out" (timeout, network error, 5xx,
 * an unreadable body) is UNKNOWN.
 *
 * Collapsing UNKNOWN into GUEST is what lost baskets: a slow /account/me made the
 * middleware replace a signed-in customer's USER cart credential with a new GUEST
 * one, the next page replaced that with a new empty USER cart, and the old basket
 * was never reachable again. It also checked a signed-in customer out as a guest.
 * UNKNOWN must never mint, replace or decide anything.
 */
export type SessionCheck =
  | { state: 'USER'; customer: AuthenticatedCustomer }
  | { state: 'GUEST' }
  | { state: 'UNKNOWN' };

/** Classifies an /account/me answer. Exported for tests. */
export function classifySessionResponse(
  status: number,
  body: { success?: boolean; data?: { id?: string } } | null,
): 'USER' | 'GUEST' | 'UNKNOWN' {
  // 404: the token verified but its account no longer exists — a definite answer.
  if (status === 401 || status === 403 || status === 404) return 'GUEST';
  if (status < 200 || status >= 300) return 'UNKNOWN';
  if (body?.success === true && typeof body.data?.id === 'string' && body.data.id) return 'USER';
  // A 2xx the API explicitly marked unsuccessful is a refusal; anything else is unreadable.
  return body?.success === false ? 'GUEST' : 'UNKNOWN';
}

export async function checkCustomerSession(
  cookies: AstroCookies,
  fetchImpl: typeof fetch = fetch,
): Promise<SessionCheck> {
  const token = cookies.get(SESSION_COOKIE)?.value;
  if (!token) return { state: 'GUEST' };

  try {
    // Asks the API who this token belongs to. The storefront deliberately does
    // not verify the signature itself: duplicating that logic in a second place
    // is how the two drift apart, and only one of them holds the key.
    const res = await fetchImpl(`${API_BASE}/account/me`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(SESSION_CHECK_TIMEOUT_MS),
    });
    const json = res.ok
      ? ((await res.json().catch(() => null)) as { success?: boolean; data?: { id?: string } } | null)
      : null;
    const state = classifySessionResponse(res.status, json);
    if (state === 'USER') return { state, customer: { userId: json!.data!.id!, apiCredential: token } };
    return { state };
  } catch {
    // An unreachable API means "cannot confirm authentication": never
    // "authenticated as whoever the cookie claims", and never "signed out".
    return { state: 'UNKNOWN' };
  }
}

/**
 * The signed-in customer, or null for BOTH guest and unknown. Only for callers
 * that make no identity-changing decision on null (a read that shows less).
 */
export async function resolveAuthenticatedCustomer(
  cookies: AstroCookies,
): Promise<AuthenticatedCustomer | null> {
  const check = await checkCustomerSession(cookies);
  return check.state === 'USER' ? check.customer : null;
}

export async function resolveAuthenticatedUserId(cookies: AstroCookies): Promise<string | null> {
  return (await resolveAuthenticatedCustomer(cookies))?.userId ?? null;
}

/**
 * The signed-in customer for THIS request. The middleware already asked the
 * API once for every document (`locals.gpUserId`); pages reuse that answer
 * instead of asking again. Asked afresh only when the middleware did not
 * resolve it (undefined: not a document, its lookup threw, or it was UNKNOWN).
 */
export async function requestUserId(
  locals: { gpUserId?: string | null },
  cookies: AstroCookies,
): Promise<string | null> {
  if (locals.gpUserId !== undefined) return locals.gpUserId;
  return resolveAuthenticatedUserId(cookies);
}

/**
 * Like requestUserId, but keeps UNKNOWN distinct. Any page that mints or
 * replaces an identity (cart credential, checkout intent) or places an order
 * must use this: on UNKNOWN it must leave every credential as it is and decide
 * nothing.
 */
export async function requestSession(
  locals: { gpUserId?: string | null },
  cookies: AstroCookies,
): Promise<{ state: 'USER'; userId: string } | { state: 'GUEST' } | { state: 'UNKNOWN' }> {
  if (typeof locals.gpUserId === 'string') return { state: 'USER', userId: locals.gpUserId };
  if (locals.gpUserId === null) return { state: 'GUEST' };
  const check = await checkCustomerSession(cookies);
  return check.state === 'USER' ? { state: 'USER', userId: check.customer.userId } : check;
}
