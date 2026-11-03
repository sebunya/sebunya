import { apiBase } from './api';
import { DEFAULT_BUSINESS_INFO, type BusinessInfo } from '@goldplus/shared';

/**
 * Business/contact info for the footer, cached in-process with a short TTL (it is
 * per-site and on every page). Falls back to the last good value / DEFAULT — the
 * footer is never a database outage.
 */
const TTL_MS = 60_000;
let cached: BusinessInfo | null = null;
let cachedAt = 0;
let inflight: Promise<BusinessInfo> | null = null;

async function fetchInfo(): Promise<BusinessInfo> {
  try {
    const res = await fetch(`${apiBase}/commerce/business-info`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(2000) });
    const json: any = res.ok ? await res.json().catch(() => null) : null;
    if (json?.success && json.data) return json.data as BusinessInfo;
  } catch {
    /* fall through */
  }
  return cached ?? DEFAULT_BUSINESS_INFO;
}

export async function getBusinessInfo(): Promise<BusinessInfo> {
  const now = Date.now();
  if (cached && now - cachedAt < TTL_MS) return cached;
  if (inflight) return inflight;
  inflight = fetchInfo()
    .then((v) => { cached = v; cachedAt = Date.now(); inflight = null; return v; })
    .catch(() => { inflight = null; return cached ?? DEFAULT_BUSINESS_INFO; });
  return inflight;
}

/**
 * The same-day cut-off hour as customers read it ("3pm"), from ONE formatter. Null for a value that is not an hour
 * (an admin typo), so no page prints "NaNam" or "13am".
 */
export function formatCutoffHour(h: unknown): string | null {
  if (typeof h !== 'number' || !Number.isInteger(h) || h < 0 || h > 23) return null;
  return `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;
}

/** For a sentence ("Order before …"): the hour, or words that stay true when the hour is unknown. */
export function cutoffPhrase(h: unknown): string {
  return formatCutoffHour(h) ?? 'the daily cut-off';
}
