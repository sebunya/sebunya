import type { APIRoute } from 'astro';
import { clearSessionCookie, readSessionToken } from '../../lib/session';
import { apiBase } from '../../lib/api';

/**
 * Administrative sign-out, done where it can actually work.
 *
 * The button used to run `document.cookie = "goldplus_session=; ..."` in the
 * browser. The session cookie is HttpOnly, and browsers ignore script writes
 * that would delete an HttpOnly cookie — so "Sign out" cleared nothing and the
 * bearer token stayed valid for its full lifetime. On a shared machine that is
 * an administrator who believes they have signed out and has not.
 *
 * Two things have to happen, in this order:
 *   1. revoke server-side (logout-all, so every outstanding token for that
 *      user dies, not just this browser's);
 *   2. clear the cookie from the SERVER with Set-Cookie, which is the only
 *      party allowed to touch an HttpOnly cookie.
 *
 * Revocation is best-effort: if the API is unreachable the cookie is still
 * cleared and the operator is still returned to the login screen. A sign-out
 * that fails closed on a network hiccup would leave the session visible in the
 * browser, which is worse than a revocation that has to be retried.
 */
export const POST: APIRoute = async ({ request }) => {
  const token = readSessionToken(request);

  if (token) {
    try {
      await fetch(`${apiBase}/auth/logout-all`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // Best-effort by design — see above.
    }
  }

  return new Response(null, {
    status: 303,
    headers: {
      Location: '/admin/login',
      'Set-Cookie': clearSessionCookie(),
    },
  });
};

export const GET = POST;
