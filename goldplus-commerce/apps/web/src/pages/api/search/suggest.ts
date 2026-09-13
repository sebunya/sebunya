import type { APIRoute } from 'astro';
import { apiBase } from '../../../lib/api';

/**
 * Same-origin predictive-search relay (Stage 3). The header's search box calls
 * its OWN origin so there is no CORS dependency; this hop forwards a single,
 * length-capped query to the public autocomplete endpoint. It is an ALLOWLIST,
 * not a forwarder — one path, GET only, only `q` and a fixed limit pass through,
 * and an upstream failure is reported as success:false (never cached) so the
 * search box can show "couldn't load" instead of an empty catalogue.
 */

const json = (status: number, body: unknown, cache = 'public, max-age=30') =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': cache },
  });

export const GET: APIRoute = async ({ url }) => {
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 80);
  if (!q) return json(200, { success: true, data: [] });
  try {
    const res = await fetch(`${apiBase}/products/suggest?q=${encodeURIComponent(q)}&limit=6`, {
      signal: AbortSignal.timeout(2500),
    });
    const j: any = await res.json().catch(() => null);
    if (!res.ok || !j?.success || !Array.isArray(j.data)) {
      // Upstream unavailable: tell the client honestly (it renders "couldn't load", not
      // "no match") and never cache the failure.
      return json(200, { success: false, data: [], error: 'UPSTREAM_UNAVAILABLE' }, 'no-store');
    }
    return json(200, { success: true, data: j.data });
  } catch {
    return json(200, { success: false, data: [], error: 'UPSTREAM_UNAVAILABLE' }, 'no-store');
  }
};
