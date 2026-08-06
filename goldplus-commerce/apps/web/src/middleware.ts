import { defineMiddleware } from "astro:middleware";

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
const VISIT_COOKIE_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,128}$/;

function mintVisitToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const onRequest = defineMiddleware((context, next) => {
  // Asset and API-relay requests keep whatever cookie state they arrived
  // with; only document requests mint. (The relay still READS the cookie.)
  const path = context.url.pathname;
  const isDocument = !path.startsWith("/api/") && !path.startsWith("/_astro/") && !path.includes(".");

  const existing = context.cookies.get(VISIT_COOKIE_NAME)?.value;
  if (existing && TOKEN_SHAPE.test(existing)) {
    context.locals.gpVisit = existing;
  } else if (isDocument) {
    const token = mintVisitToken();
    context.cookies.set(VISIT_COOKIE_NAME, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: import.meta.env.PROD,
      maxAge: VISIT_COOKIE_MAX_AGE_SECONDS,
    });
    context.locals.gpVisit = token;
  }

  return next();
});
