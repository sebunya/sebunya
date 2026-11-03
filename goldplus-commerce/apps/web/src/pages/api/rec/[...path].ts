import type { APIRoute } from "astro";
import { isDeclaredAutomation } from "../../../lib/declaredAutomation";
import { apiBase } from "../../../lib/api";
import { relayHeaders } from "../../../lib/relayHeaders";
import { readBodyCapped } from "../../../lib/boundedBody";

/**
 * Same-origin relay for storefront recommendation events (R2, 2026-08-06).
 *
 * Follows the proven measurement-proxy discipline (MEASURE-1): the browser
 * calls its OWN origin, and this server-side hop attaches what page scripts
 * must never hold — here the HttpOnly visit token, forwarded as a header the
 * API resolves into a server-side profile. This removes the cross-origin
 * dependency for event capture entirely: if CORS configuration drifts, events
 * still land.
 *
 * An ALLOWLIST, not a forwarder: exactly one path, one method, body size
 * capped. It cannot become an SSRF or a generic relay.
 */


const MAX_BODY_BYTES = 8 * 1024;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });


export const POST: APIRoute = async (context) => {
  const { request, params } = context;
  // Declared automation runs our scripts; what it "does" is not shopping.
  if (isDeclaredAutomation(request.headers)) return new Response(null, { status: 204 });
  if ((params.path ?? "") !== "events") {
    return json(404, { success: false, error: { code: "NOT_PROXIED", message: "This endpoint is not proxied." } });
  }

  // R9 (M7): the cap is enforced WHILE the body streams in. Checking only the
  // declared Content-Length let a chunked upload (which declares nothing)
  // buffer tens of megabytes into this SSR process before the byte check ran.
  const read = await readBodyCapped(request, MAX_BODY_BYTES);
  if (!read.ok) {
    return json(413, { success: false, error: { code: "EVENT_TOO_LARGE", message: "Event payload too large." } });
  }
  const raw = read.text;

  // Signed visit token (locals.gpVisit) and the visitor's address, via lib/relayHeaders.
  const headers = relayHeaders(context, { "Content-Type": "application/json", Accept: "application/json" });
  // The browser's user agent travels too (#4): the API screens these events
  // with botDetectionMiddleware, which reads a missing user agent as a bot, so
  // a relay that sent none had every real event dropped. Length-capped; the
  // value is only ever matched against patterns upstream.
  const ua = request.headers.get("user-agent");
  if (ua) headers["User-Agent"] = ua.slice(0, 512);
  // The real client address travels with the request so abuse control can
  // attribute per-visitor rather than per-web-container.

  try {
    const response = await fetch(`${apiBase}/recommendations/events`, {
      method: "POST",
      headers,
      body: raw,
      signal: AbortSignal.timeout(10_000),
    });
    const body = await response.text();
    return new Response(body, { status: response.status, headers: { "Content-Type": "application/json" } });
  } catch {
    return json(502, { success: false, error: { code: "UPSTREAM_UNAVAILABLE", message: "Event service unreachable." } });
  }
};

export const GET: APIRoute = async () =>
  json(405, { success: false, error: { code: "METHOD_NOT_ALLOWED", message: "POST only." } });
