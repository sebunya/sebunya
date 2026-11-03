import type { APIRoute } from 'astro';
import { clearRefreshCookie, clearSessionCookie, readRefreshToken, readSessionToken } from '../lib/session';
import { apiBase } from '../lib/api';
import { checkRequestOrigin } from '../lib/requestOrigin';
import { mintSignedVisitToken } from '../lib/visitToken';
import { VISIT_COOKIE_NAME, visitCookieOptions } from '../middleware';

/**
 * Customer sign-out, done where it can actually work.
 *
 * It used to clear the session cookie and nothing else, so two things outlived
 * an explicit "Sign out":
 *   1. the 7-day bearer token stayed valid server-side (the admin sign-out has
 *      always revoked it with logout-all; the customer one never did);
 *   2. the gp_visit cookie, which login ROTATES and links to the customer,
 *      stayed linked, so the next person on a shared phone or cyber-café PC was
 *      greeted by the previous customer's first name, district and points.
 *
 * Revocation is best-effort (an API outage must not leave the cookie in place)
 * and revokes this session only; ?scope=all signs out on every device
 * and only for a request the browser itself marks as coming from our own pages.
 * /logout is a plain GET link, so without that check any site could navigate a
 * visitor here and end every one of their sessions on every device.
 *
 * The visit cookie is replaced by a fresh, UNLINKED token — the mirror of the
 * login rotation. Recommendation continuity restarts, which is the point.
 */
export const GET: APIRoute = async ({ request, cookies, url }) => {
  const token = readSessionToken(request);
  const refreshToken = readRefreshToken(request);
  // "Sign out" ends THIS browser's session only (POST /auth/logout revokes the
  // presented refresh credential's family). Signing out on a cyber-café PC must
  // not also sign the customer out on their own phone. Ending every session is
  // the explicit /logout?scope=all ("sign out everywhere"), via logout-all.
  const everywhere = url.searchParams.get('scope') === 'all';
  if ((token || refreshToken) && checkRequestOrigin(request, import.meta.env as unknown as Record<string, string | undefined>).allowed) {
    try {
      if (everywhere && token) {
        await fetch(`${apiBase}/auth/logout-all`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(3000),
        });
      } else if (refreshToken) {
        await fetch(`${apiBase}/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken: decodeURIComponent(refreshToken) }),
          signal: AbortSignal.timeout(3000),
        });
      }
    } catch {
      // Best-effort by design — the cookie is still cleared below.
    }
  }

  const freshVisit = mintSignedVisitToken();
  if (freshVisit) cookies.set(VISIT_COOKIE_NAME, freshVisit, visitCookieOptions());
  else cookies.delete(VISIT_COOKIE_NAME, { path: '/' });

  // Both cookies: the refresh credential was revoked above, and a dead one left
  // in the browser would only cost a pointless renewal call. (The 15-minute
  // access token is no longer held anywhere once the cookie is gone.)
  const headers = new Headers({ Location: '/' });
  headers.append('Set-Cookie', clearSessionCookie());
  headers.append('Set-Cookie', clearRefreshCookie());
  return new Response(null, { status: 303, headers });
};

export const POST = GET;
