import type { APIRoute } from "astro";
import { VISIT_COOKIE_NAME } from "../../../middleware";

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

const API_BASE = (
  (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })?.process?.env?.INTERNAL_API_ORIGIN
  || (import.meta.env.PUBLIC_API_BASE_URL as string | undefined)
  || "http://localhost:3000"
).replace(/\/+$/, "");

const MAX_BODY_BYTES = 8 * 1024;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const VISIT_TOKEN_SHAPE = /^[A-Za-z0-9_-]{44}$/;

export const POST: APIRoute = async ({ request, params, cookies, clientAddress }) => {
  if ((params.path ?? "") !== "events") {
    return json(404, { success: false, error: { code: "NOT_PROXIED", message: "This endpoint is not proxied." } });
  }

  // R9 (M7): the declared length is refused BEFORE the body is buffered — the
  // old order materialised an arbitrarily large body into this SSR process
  // first and measured it after (and measured UTF-16 code units, not bytes).
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json(413, { success: false, error: { code: "EVENT_TOO_LARGE", message: "Event payload too large." } });
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return json(413, { success: false, error: { code: "EVENT_TOO_LARGE", message: "Event payload too large." } });
  }

  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  // Shape-checked before forwarding: junk cookies never ride into an upstream
  // header, and the API's signature check does the real verification.
  const visit = cookies.get(VISIT_COOKIE_NAME)?.value;
  if (visit && VISIT_TOKEN_SHAPE.test(visit)) headers["x-gp-visit"] = visit;
  // The real client address travels with the request so abuse control can
  // attribute per-visitor rather than per-web-container.
  try {
    if (clientAddress) headers["X-Forwarded-For"] = clientAddress;
  } catch {
    // clientAddress can throw in prerender contexts; the relay works without it.
  }

  try {
    const response = await fetch(`${API_BASE}/recommendations/events`, {
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
