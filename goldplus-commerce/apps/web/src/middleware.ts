import { defineMiddleware } from "astro:middleware";
import { prefersMarkdown, markdownResponse } from "./lib/agentMarkdown";
import { agentDocumentFor, agentRepresentablePath } from "./lib/agentDocuments";
import { isSignedVisitToken, mintSignedVisitToken } from "./lib/visitToken";
import { apiBase } from "./lib/api";
import { SESSION_COOKIE_NAME } from "./lib/session";

/**
 * The opaque visit locator (R2, 2026-08-06).
 *
 * The ONLY thing the browser holds is this cookie: a random value with no
 * meaning off the server. HttpOnly (page scripts can never read it), Secure in
 * production, SameSite=Lax, 180 days — aligned with the cart-continuity
 * direction. The server stores its SHA-256 in experience_profiles and hangs
 * all continuity off that row.
 *
 * A cleared or rejected cookie costs exactly its continuity: the next request
 * mints a fresh locator and the site works identically (AC51). No banner, no
 * block, no fallback to client storage.
 */

export const VISIT_COOKIE_NAME = "gp_visit";
export const VISIT_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

export function visitCookieOptions() {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: import.meta.env.PROD,
    maxAge: VISIT_COOKIE_MAX_AGE_SECONDS,
  } as const;
}

/**
 * Admin pages authenticated on the PRESENCE of a cookie — the same cookie a
 * customer holds — so a signed-in customer could render the admin console. No
 * privileged data leaked, because every admin API enforces its own permission,
 * but the console is not theirs to see.
 *
 * One call to /auth/admin-session settles it: authMiddleware refuses an account with
 * no permissions, so a 200 means a real admin.
 *
 * Fail CLOSED on a definite refusal (401/403): that is the case this exists for.
 * Fail OPEN on a timeout or an unreachable API: a blip must not lock the
 * operator out of the console they would use to diagnose it, and the pages
 * behind this still cannot read a single privileged byte without the API.
 */
async function holderIsAdmin(request: Request): Promise<boolean> {
  const cookie = request.headers.get('cookie') ?? '';
  const token = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`))?.[1];
  if (!token) return false;
  try {
    const res = await fetch(`${apiBase}/auth/admin-session`, {
      headers: { Authorization: `Bearer ${decodeURIComponent(token)}` },
      signal: AbortSignal.timeout(4000),
    });
    // Only a 200 proves an admin. Treating "anything that is not 401/403" as
    // proof means a moved route, a 404 or a 502 silently stops guarding.
    if (res.ok) return true;
    if (res.status === 401 || res.status === 403) return false;
    // Any other status is the API misbehaving rather than a verdict on this
    // caller, so it degrades the same way an outage does: see the fail-open
    // note above.
    return true;
  } catch {
    return true;
  }
}

export const onRequest = defineMiddleware(async (context, next) => {
  // Markdown for agents. An assistant that asks for text/markdown gets the
  // page's facts without the navigation, scripts and styling an HTML fetch
  // spends its context on. GET only, never for /admin or /api, and only for
  // paths we can represent — anything else falls through to the HTML page, so
  // this can never blank a route. See lib/agentMarkdown.ts.
  const wantsMarkdown =
    context.request.method === 'GET' &&
    prefersMarkdown(context.request.headers.get('accept')) &&
    !context.url.pathname.startsWith('/admin') &&
    !context.url.pathname.startsWith('/api/');
  if (wantsMarkdown) {
    try {
      // Note what is NOT here: rendering the HTML page to measure it. Reporting
      // a saving is not worth doing the work the agent asked us to skip.
      const markdown = await agentDocumentFor(context.url);
      if (markdown) return markdownResponse(markdown);
    } catch {
      // An agent asking for Markdown must never be worse off than one asking
      // for HTML: fall through and serve the page.
    }
  }

  const adminPath = context.url.pathname;
  // /admin/logout must stay reachable: it is how a stale or downgraded session
  // clears its cookie, and guarding it would redirect the holder to a login
  // they cannot pass while leaving the cookie in place.
  const adminGuarded =
    adminPath.startsWith('/admin') &&
    !adminPath.startsWith('/admin/login') &&
    !adminPath.startsWith('/admin/logout');
  if (adminGuarded) {
    if (!(await holderIsAdmin(context.request))) {
      return context.redirect(`/admin/login?returnTo=${encodeURIComponent(adminPath)}`, 303);
    }
  }

  // Asset and API-relay requests keep whatever cookie state they arrived
  // with; only document requests mint. (The relay still READS the cookie.)
  // The extension check is anchored to the LAST path segment so a product
  // slug containing a dot still counts as a document.
  const path = context.url.pathname;
  const isDocument =
    !path.startsWith("/api/") && !path.startsWith("/_astro/") && !/\.[A-Za-z0-9]{2,8}$/.test(path);

  const existing = context.cookies.get(VISIT_COOKIE_NAME)?.value;
  if (isSignedVisitToken(existing)) {
    // Only tokens WE signed resolve to continuity — a fabricated or
    // stale-secret cookie is replaced, never trusted (R9 M2).
    context.locals.gpVisit = existing;
  } else if (isDocument) {
    const token = mintSignedVisitToken();
    if (token) {
      context.cookies.set(VISIT_COOKIE_NAME, token, visitCookieOptions());
      context.locals.gpVisit = token;
      // First document request we have ever seen from this browser — the cheapest
      // honest "brand-new visitor" signal (the cookie then persists 180 days), so
      // the header can pick welcome vs signup without a per-page profile lookup.
      context.locals.gpVisitIsNew = true;
    }
  }

  const response = await next();
  // Tell agents the cheaper representation exists. Only for documents we can
  // actually serve as Markdown, so the header never promises a 404.
  if (isDocument && response.status === 200 && agentRepresentablePath(path)) {
    response.headers.append('Link', `<${context.url.origin}${path}>; rel="alternate"; type="text/markdown"`);
    response.headers.append('Vary', 'Accept');
  }
  return response;
});
