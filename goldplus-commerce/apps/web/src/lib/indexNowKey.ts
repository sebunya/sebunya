import { apiBase } from './api';

/**
 * The IndexNow key, asked of the API at most once per TTL. Every request for an
 * unknown /<8-128 chars>.txt (crawlers, scanners) used to cost an API round trip
 * with no timeout. A failed read is cached briefly too, so an API outage does
 * not turn each scan into a waiting fetch.
 */
const OK_TTL_MS = 5 * 60 * 1000;
const FAIL_TTL_MS = 30 * 1000;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

let cached: { key: string | null; until: number } | null = null;
let inFlight: Promise<string | null> | null = null;

export async function indexNowKey(opts: { fetchImpl?: FetchLike; now?: () => number } = {}): Promise<string | null> {
  const now = (opts.now ?? Date.now)();
  if (cached && cached.until > now) return cached.key;
  if (inFlight) return inFlight;
  const fetchImpl: FetchLike = opts.fetchImpl ?? ((i, init) => fetch(i, init));
  inFlight = (async () => {
    let key: string | null = null;
    let ok = false;
    try {
      const res = await fetchImpl(`${apiBase}/seo/indexnow-key`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) {
        const body = (await res.json()) as { data?: { key?: unknown } };
        key = typeof body?.data?.key === 'string' && body.data.key ? body.data.key : null;
        ok = true;
      }
    } catch { /* treated as unknown, retried after FAIL_TTL_MS */ }
    cached = { key, until: now + (ok ? OK_TTL_MS : FAIL_TTL_MS) };
    return key;
  })();
  try { return await inFlight; } finally { inFlight = null; }
}

/** Tests only. */
export function resetIndexNowKeyCache(): void { cached = null; inFlight = null; }
