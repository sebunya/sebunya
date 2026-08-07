import { defineMiddleware } from "astro:middleware";
import { isSignedVisitToken, mintSignedVisitToken } from "./lib/visitToken";

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

export const onRequest = defineMiddleware((context, next) => {
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

  return next();
});
