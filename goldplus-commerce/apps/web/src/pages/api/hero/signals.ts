import type { APIRoute } from "astro";
import { apiBase } from "../../../lib/api";
import { relayHeaders } from "../../../lib/relayHeaders";

/**
 * Same-origin relay for per-visitor hero signals (Task 3, 2026-08-07).
 *
 * Mirrors the recommendation relay: the browser calls its OWN origin, and this
 * server-side hop attaches the HttpOnly visit token the page scripts must never
 * hold. The response is per-visitor, so it is returned no-store — an edge cache
 * must never share one visitor's signals with another.
 */

const noStore = { "Content-Type": "application/json", "Cache-Control": "private, no-store" };

export const GET: APIRoute = async (context) => {
  // Signed visit token (locals.gpVisit) and the visitor's address, via lib/relayHeaders.
  const headers = relayHeaders(context, { Accept: "application/json" });
  // Without a client address the API treats this as an internal call and
  // applies no abuse budget at all; forward the visitor's, as the rec relay does.
  try {
    const res = await fetch(`${apiBase}/hero/signals`, { headers, signal: AbortSignal.timeout(4000) });
    const body = await res.text();
    return new Response(body, { status: res.status, headers: noStore });
  } catch {
    // Signals are an enhancement; failing quietly leaves the neutral hero intact.
    return new Response(JSON.stringify({ success: false, error: { code: "UPSTREAM_UNAVAILABLE" } }), { status: 502, headers: noStore });
  }
};
