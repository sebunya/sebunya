import type { APIRoute } from 'astro';
import { apiBase } from '../../../lib/api';

/**
 * Same-origin predictive-search relay (Stage 3). The header's search box calls
 * its OWN origin so there is no CORS dependency; this hop forwards a single,
 * length-capped query to the public autocomplete endpoint. It is an ALLOWLIST,
 * not a forwarder — one path, GET only, only `q` and a fixed limit pass through,
 * and any failure degrades to an empty list so the search box never errors.
 */

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' },
  });

export const GET: APIRoute = async ({ url }) => {
  const q = (url.searchParams.get('q') ?? '').trim().slice(0, 80);
  if (!q) return json(200, { success: true, data: [] });
  try {
    const res = await fetch(`${apiBase}/products/suggest?q=${encodeURIComponent(q)}&limit=6`, {
      signal: AbortSignal.timeout(2500),
    });
    const j: any = await res.json().catch(() => null);
    return json(200, { success: true, data: j?.success && Array.isArray(j.data) ? j.data : [] });
  } catch {
    return json(200, { success: true, data: [] });
  }
};
