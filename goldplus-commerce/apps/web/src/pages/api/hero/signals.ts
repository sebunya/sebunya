import type { APIRoute } from "astro";
import { VISIT_COOKIE_NAME } from "../../../middleware";

/**
 * Same-origin relay for per-visitor hero signals (Task 3, 2026-08-07).
 *
 * Mirrors the recommendation relay: the browser calls its OWN origin, and this
 * server-side hop attaches the HttpOnly visit token the page scripts must never
 * hold. The response is per-visitor, so it is returned no-store — an edge cache
 * must never share one visitor's signals with another.
 */
const API_BASE = (
  (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })?.process?.env?.INTERNAL_API_ORIGIN
  || (import.meta.env.PUBLIC_API_BASE_URL as string | undefined)
  || "http://localhost:3000"
).replace(/\/+$/, "");

const VISIT_TOKEN_SHAPE = /^[A-Za-z0-9_-]{44}$/;
const noStore = { "Content-Type": "application/json", "Cache-Control": "private, no-store" };

export const GET: APIRoute = async ({ cookies }) => {
  const headers: Record<string, string> = { Accept: "application/json" };
  const visit = cookies.get(VISIT_COOKIE_NAME)?.value;
  if (visit && VISIT_TOKEN_SHAPE.test(visit)) headers["x-gp-visit"] = visit;
  try {
    const res = await fetch(`${API_BASE}/hero/signals`, { headers, signal: AbortSignal.timeout(4000) });
    const body = await res.text();
    return new Response(body, { status: res.status, headers: noStore });
  } catch {
    // Signals are an enhancement; failing quietly leaves the neutral hero intact.
    return new Response(JSON.stringify({ success: false, error: { code: "UPSTREAM_UNAVAILABLE" } }), { status: 502, headers: noStore });
  }
};
