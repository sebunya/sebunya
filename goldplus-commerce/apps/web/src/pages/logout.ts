import type { APIRoute } from 'astro';
import { clearSessionCookie, readSessionToken } from '../lib/session';
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
 * and only for a request the browser itself marks as coming from our own pages.
 * /logout is a plain GET link, so without that check any site could navigate a
 * visitor here and end every one of their sessions on every device.
 *
 * The visit cookie is replaced by a fresh, UNLINKED token — the mirror of the
 * login rotation. Recommendation continuity restarts, which is the point.
 */
export const GET: APIRoute = async ({ request, cookies }) => {
  const token = readSessionToken(request);
  if (token && checkRequestOrigin(request, import.meta.env as unknown as Record<string, string | undefined>).allowed) {
    try {
      await fetch(`${apiBase}/auth/logout-all`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      // Best-effort by design — the cookie is still cleared below.
    }
  }

  const freshVisit = mintSignedVisitToken();
  if (freshVisit) cookies.set(VISIT_COOKIE_NAME, freshVisit, visitCookieOptions());
  else cookies.delete(VISIT_COOKIE_NAME, { path: '/' });

  return new Response(null, {
    status: 303,
    headers: {
      Location: '/',
      'Set-Cookie': clearSessionCookie(),
    },
  });
};

export const POST = GET;
