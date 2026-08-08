import { apiBase } from './api';
import { DEFAULT_TAXONOMY, type Taxonomy } from '@goldplus/shared';

/**
 * Product discovery taxonomy, cached in-process with a short TTL (it drives the
 * homepage tiles and shop filters on many pages). Falls back to the last good
 * value / DEFAULT — discovery is never a database outage.
 */
const TTL_MS = 60_000;
let cached: Taxonomy | null = null;
let cachedAt = 0;
let inflight: Promise<Taxonomy> | null = null;

async function fetchTaxonomy(): Promise<Taxonomy> {
  try {
    const res = await fetch(`${apiBase}/commerce/taxonomy`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(2000) });
    const json: any = res.ok ? await res.json().catch(() => null) : null;
    if (json?.success && Array.isArray(json.data) && json.data.length > 0) return json.data as Taxonomy;
  } catch {
    /* fall through */
  }
  return cached ?? DEFAULT_TAXONOMY;
}

export async function getTaxonomy(): Promise<Taxonomy> {
  const now = Date.now();
  if (cached && now - cachedAt < TTL_MS) return cached;
  if (inflight) return inflight;
  inflight = fetchTaxonomy()
    .then((v) => { cached = v; cachedAt = Date.now(); inflight = null; return v; })
    .catch(() => { inflight = null; return cached ?? DEFAULT_TAXONOMY; });
  return inflight;
}
