import { defineMiddleware } from "astro:middleware";
import { SITE_ORIGIN } from './lib/sitemap';
import { prefersMarkdown, markdownResponse } from "./lib/agentMarkdown";
import { agentDocumentFor, agentRepresentablePath } from "./lib/agentDocuments";
import { resolveRequestIdentity } from "./lib/requestIdentity";
import { isSignedVisitToken, mintSignedVisitToken } from "./lib/visitToken";
import { apiBase } from "./lib/api";
import { visitorCookieDomain } from "./lib/visitorCookieDomain";
import { readRefreshToken, readSessionToken, setRequestSessionToken, setSignInCookies, clearSignInCookies, tokenSecondsLeft } from "./lib/session";
import { apiHeaders, readClientAddress } from "./lib/forwardClient";
import { makeNonce, nonceScriptStream, strictPolicyMode, strictReportOnlyPolicy } from "./lib/contentSecurityPolicy";
import { PublicFormLimiter, budgetedFormPath, tooManySubmissionsResponse, visitorKey } from "./lib/publicFormLimiter";

// Public forms reach the API server side, where its per-visitor budgets cannot
// see the visitor (lib/publicFormLimiter.ts). The budget is applied here.
const publicFormLimiter = new PublicFormLimiter();

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
// Owner decision 2026-09-20: personalisation continuity is kept for as long as
// the browser allows. Browsers cap a cookie at 400 days, so the lifetime is
// that cap and it SLIDES: every day the visitor comes back it is renewed, so
// anyone who returns at least once in 400 days is never forgotten.
export const VISIT_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

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
  // Through readSessionToken: it sees a token the renewal step just issued.
  const token = readSessionToken(request);
  if (!token) return false;
  // Decoded before the try: a malformed cookie (e.g. "%E0") threw URIError
  // inside it and the catch below let any visitor render the console.
  let bearer: string;
  try { bearer = decodeURIComponent(token); } catch { return false; }
  try {
    const res = await fetch(`${apiBase}/auth/admin-session`, {
      headers: { Authorization: `Bearer ${bearer}` },
      signal: AbortSignal.timeout(4000),
    });
    // Only a 200 proves an admin. Treating "anything that is not 401/403" as
    // proof means a moved route, a 404 or a 502 silently stops guarding.
    if (res.ok) return true;
    if (res.status === 401 || res.status === 403) return false;
    // Any other 4xx is a refusal too (a moved route answers 404, and that
    // must not open the console). 429 and 5xx are the API under strain, not a
    // verdict on this caller, so they degrade like an outage.
    if (res.status < 500 && res.status !== 429) return false;
    return true;
  } catch {
    return true;
  }
}

/**
 * Moved pages. The shop page was /locations/wilson-road until 2026-10-03, then
 * /locations/new-pioneer-mall until 2026-10-06, when the owner corrected the
 * building's name: the shop is in the Zainab Aziza Building (Burton Street
 * face), opposite Pioneer Mall. A `redirects`
 * entry in astro.config.mjs does NOT fire under the node server adapter (the
 * old slug rendered the 404 page, checked on the built server 2026-10-05), so
 * the redirect lives here, before anything else looks at the path.
 */
export const MOVED_PATHS: Readonly<Record<string, string>> = {
  '/locations/wilson-road': '/locations/zainab-aziza',
  '/locations/new-pioneer-mall': '/locations/zainab-aziza',
};

/** Renew this long before expiry, so a page's own API calls never meet a dead token. */
const RENEW_WHEN_SECONDS_LEFT = 120;

/**
 * Session renewal (2026-10-07). Access tokens live 15 minutes; when the one in
 * the cookie is expiring (or gone) and a refresh credential is present, swap it
 * for a fresh pair BEFORE anything else reads the session. A refusal (revoked,
 * expired, reused) signs the visitor out; an API outage changes nothing, and the
 * page treats the old token as it always did.
 */
async function renewSessionIfDue(context: Parameters<Parameters<typeof defineMiddleware>[0]>[0]): Promise<void> {
  const refreshToken = readRefreshToken(context.request);
  if (!refreshToken) return;
  const token = readSessionToken(context.request);
  const left = token ? tokenSecondsLeft(token) : -1;
  if (left !== null && left > RENEW_WHEN_SECONDS_LEFT) return;
  try {
    const res = await fetch(`${apiBase}/auth/refresh`, {
      method: 'POST',
      headers: apiHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }, readClientAddress(context)),
      body: JSON.stringify({ refreshToken: decodeURIComponent(refreshToken) }),
      signal: AbortSignal.timeout(4000),
    });
    const json: any = await res.json().catch(() => null);
    if (res.ok && json?.success && typeof json.data?.token === 'string') {
      setSignInCookies(context.cookies, json.data); // a concurrent-refresh answer carries no new refresh token: the cookie stays
      setRequestSessionToken(context.request, json.data.token);
    } else if (res.status === 401) {
      clearSignInCookies(context.cookies);
      setRequestSessionToken(context.request, null);
    }
  } catch {
    /* unreachable API: leave the session as it is */
  }
}

export const onRequest = defineMiddleware(async (context, next) => {
  const moved = MOVED_PATHS[context.url.pathname.replace(/\/+$/, '') || '/'];
  if (moved) return context.redirect(`${moved}${context.url.search}`, 301);
  if (!context.url.pathname.startsWith('/_astro/')) await renewSessionIfDue(context);

  if (context.request.method === 'POST') {
    const formPath = budgetedFormPath(context.url.pathname);
    if (formPath && !publicFormLimiter.allow(formPath, visitorKey(context.request.headers, () => context.clientAddress))) {
      return tooManySubmissionsResponse();
    }
  }

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
  // Machine endpoints (/mcp, /.well-known/*) are not pages: no analytics visitor
  // cookie and no page Link headers on their responses.
  const isDocument =
    !path.startsWith("/api/") && !path.startsWith("/_astro/") && !path.startsWith("/.well-known/") && path !== "/mcp" &&
    !/\.[A-Za-z0-9]{2,8}$/.test(path);

  // The analytics visitor id (`_fp_cid`, GA's client_id) is set by the SERVER
  // and refreshed on every page: Safari caps cookies written by JavaScript at 7
  // days, so a script-set id turned every returning Safari shopper into a new
  // user. Not HttpOnly: the page's tag reads it. Same format as lib/telemetry.
  // Refreshed at most once a day (the `_fp_r` marker): a Set-Cookie on EVERY
  // page would make every HTML response uncacheable at the edge.
  // Set for every visitor: server-side measurement is always on (owner
  // decision 2026-09-19); this is a first-party id our own server sets.
  // Read BEFORE the block below sets it: absent = first document today.
  const firstDocumentToday = isDocument && !context.cookies.get('_fp_r');
  if (isDocument) {
    const fp = context.cookies.get('_fp_cid')?.value;
    const valid = !!fp && /^fp\.\d+\.[0-9a-f-]{36}$/.test(fp);
    if (!valid || !context.cookies.get('_fp_r')) {
      const id = valid ? fp! : `fp.${Date.now()}.${crypto.randomUUID()}`;
      // Domain-scoped so the collector on api. receives it (lib/visitorCookieDomain).
      context.cookies.set('_fp_cid', id, { path: '/', domain: visitorCookieDomain(context.url.hostname), maxAge: 60 * 60 * 24 * 395, sameSite: 'lax', secure: true, httpOnly: false });
      context.cookies.set('_fp_r', '1', { path: '/', maxAge: 60 * 60 * 24, sameSite: 'lax', secure: true, httpOnly: true });
    }
  }

  const existing = context.cookies.get(VISIT_COOKIE_NAME)?.value;
  if (isSignedVisitToken(existing)) {
    // Only tokens WE signed resolve to continuity — a fabricated or
    // stale-secret cookie is replaced, never trusted (R9 M2).
    context.locals.gpVisit = existing;
    // Slide the lifetime, at most once a day (same cadence as `_fp_r`).
    if (firstDocumentToday) context.cookies.set(VISIT_COOKIE_NAME, existing, visitCookieOptions());
  } else if (isDocument) {
    const token = mintSignedVisitToken();
    if (token) {
      context.cookies.set(VISIT_COOKIE_NAME, token, visitCookieOptions());
      // A token minted on THIS request is not an identity yet: nothing proves
      // the client keeps cookies. Forwarding it made every crawler, link
      // preview and monitor probe create one profile per page load (780,545 of
      // 780,935 profiles were seen exactly once). It becomes `locals.gpVisit`
      // when the browser sends it back. SSR_IDENTITY_V2=false restores the
      // old forwarding.
      if (process.env.SSR_IDENTITY_V2 === 'false') context.locals.gpVisit = token;
      // First document request we have ever seen from this browser — the cheapest
      // honest "brand-new visitor" signal (the cookie then persists 180 days), so
      // the header can pick welcome vs signup without a per-page profile lookup.
      context.locals.gpVisitIsNew = true;
    }
  }

  // The cart credential is minted HERE, not in the header component. Setting a
  // cookie from a component runs after the response has begun, so Astro drops
  // it with a warning and the shopper is handed a brand-new basket on every
  // page — 343 such warnings per container in six hours before this moved
  // (2026-09-02). Documents only: an asset request has no basket.
  if (isDocument) {
    // A session check that cannot answer is UNKNOWN, never "guest": it reuses the
    // credential it finds and replaces nothing (lib/requestIdentity).
    try {
      const identity = await resolveRequestIdentity(context.cookies);
      context.locals.gpUserId = identity.gpUserId;
      context.locals.gpSessionUnknown = identity.gpSessionUnknown;
      context.locals.gpCart = identity.gpCart;
    } catch {
      // A basket is not worth failing a page render for; the component falls
      // back to resolving one itself.
      context.locals.gpCart = undefined;
    }
  }

  // Made BEFORE rendering: templates put it on the inline scripts they own.
  const cspNonce = makeNonce();
  context.locals.cspNonce = cspNonce;
  const response = await next();
  // Tell agents the cheaper representation exists. Only for documents we can
  // actually serve as Markdown, so the header never promises a 404.
  if (isDocument && response.status === 200 && agentRepresentablePath(path)) {
    response.headers.append('Link', `<${context.url.origin}${path}>; rel="alternate"; type="text/markdown"`);
    response.headers.append('Vary', 'Accept');
  }
  // Discovery for agents on every page (RFC 8288 links, RFC 9727 api-catalog):
  // where the machine-readable descriptions of this site live. Headers, not
  // <link> tags, so the documents' byte budget is untouched.
  if (isDocument && response.status === 200 && (response.headers.get('content-type') ?? '').startsWith('text/html')) {
    response.headers.append('Link', `<${SITE_ORIGIN}/.well-known/api-catalog>; rel="api-catalog"`);
    response.headers.append('Link', `<${SITE_ORIGIN}/openapi.json>; rel="service-desc"; type="application/openapi+json"`);
    response.headers.append('Link', `<${SITE_ORIGIN}/llms.txt>; rel="describedby"; type="text/plain"`);
  }
  return withStrictScriptPolicyReport(response, cspNonce);
});

/**
 * Every HTML page carries a fresh nonce on its <script> tags and the strict
 * script policy (lib/contentSecurityPolicy). CSP_STRICT_MODE decides how it is sent:
 *   report  (default) Content-Security-Policy-Report-Only — nothing is blocked
 *   enforce           Content-Security-Policy — alongside Caddy's policy; a script must pass both
 *   off               no nonce, no header
 */
function withStrictScriptPolicyReport(response: Response, nonce: string): Response {
  const mode = strictPolicyMode(process.env.CSP_STRICT_MODE);
  if (mode === 'off') return response;
  const type = response.headers.get('content-type') ?? '';
  if (!type.toLowerCase().startsWith('text/html') || !response.body) return response;
  const headers = new Headers(response.headers);
  headers.delete('content-length'); // the body grows by the nonce attributes
  headers.set(mode === 'enforce' ? 'Content-Security-Policy' : 'Content-Security-Policy-Report-Only', strictReportOnlyPolicy(nonce));
  return new Response(response.body.pipeThrough(nonceScriptStream(nonce)), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
