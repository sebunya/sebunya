import type { APIRoute } from "astro";
import { isDeclaredAutomation } from "../../../lib/declaredAutomation";
import { VISIT_COOKIE_NAME } from "../../../middleware";
import { readBodyCapped } from "../../../lib/boundedBody";

/**
 * Same-origin relay for header/nav telemetry (§10). One path, POST only, small
 * body — an allowlist, not a forwarder. The browser calls its OWN origin; this
 * hop attaches the HttpOnly visit token the page scripts must never hold. Any
 * failure degrades to a 502 the client swallows — telemetry never breaks a page.
 */
const API_BASE = (
  (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })?.process?.env?.INTERNAL_API_ORIGIN
  || (import.meta.env.PUBLIC_API_BASE_URL as string | undefined)
  || "http://localhost:3000"
).replace(/\/+$/, "");

const MAX_BODY_BYTES = 2 * 1024;
const VISIT_TOKEN_SHAPE = /^[A-Za-z0-9_-]{44}$/;
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const POST: APIRoute = async ({ request, cookies, clientAddress }) => {
  // Declared automation runs our scripts; what it "does" is not shopping.
  if (isDeclaredAutomation(request.headers)) return new Response(null, { status: 204 });
  // Capped while it streams: a chunked body declares no length at all.
  const read = await readBodyCapped(request, MAX_BODY_BYTES);
  if (!read.ok) return json(413, { success: false });
  const raw = read.text;

  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  const visit = cookies.get(VISIT_COOKIE_NAME)?.value;
  if (visit && VISIT_TOKEN_SHAPE.test(visit)) headers["x-gp-visit"] = visit;
  // The visitor's address, so the API's abuse control budgets THEM. A request
  // with no client address is treated as an internal service call and skips
  // the limit entirely, which left this public write path unthrottled.
  try {
    if (clientAddress) headers["X-Forwarded-For"] = clientAddress;
  } catch {
    // clientAddress can throw in prerender contexts; the relay works without it.
  }
  try {
    const res = await fetch(`${API_BASE}/nav/events`, { method: "POST", headers, body: raw, signal: AbortSignal.timeout(5000) });
    const body = await res.text();
    return new Response(body, { status: res.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  } catch {
    return json(502, { success: false });
  }
};

export const GET: APIRoute = async () => json(405, { success: false, error: { code: "METHOD_NOT_ALLOWED", message: "POST only." } });
