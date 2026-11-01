import { apiBase } from './api';

/**
 * Domain verification codes for the <head> (Meta's facebook-domain-verification),
 * saved by the owner on the Advertising page, and whether Google Ads retargeting
 * from site visits is on (BaseLayout's Consent Mode ad signals, the cookies page). Cached in-process for a minute,
 * like the business info: it is read on every page and changes almost never.
 * A code is printed only if it is the plain token Meta issues; anything else
 * (or an API that cannot be reached) prints nothing.
 */
const TTL_MS = 60_000;
const CODE = /^[a-z0-9]{20,64}$/i;
export interface SiteHeadInfo { meta: string | null; googleAdsRemarketing: boolean }
let cached: SiteHeadInfo = { meta: null, googleAdsRemarketing: false };
let cachedAt = 0;
let inflight: Promise<SiteHeadInfo> | null = null;

async function load(): Promise<SiteHeadInfo> {
  try {
    const res = await fetch(`${apiBase}/advertising/site-verification`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(2000) });
    const j = res.ok ? await res.json() : null;
    const meta = typeof j?.data?.meta === 'string' && CODE.test(j.data.meta) ? j.data.meta : null;
    return j?.success ? { meta, googleAdsRemarketing: j.data.googleAdsRemarketing === true } : cached;
  } catch {
    return cached;
  }
}

export async function getSiteVerification(): Promise<SiteHeadInfo> {
  if (cachedAt && Date.now() - cachedAt < TTL_MS) return cached;
  inflight ??= load().then((v) => { cached = v; cachedAt = Date.now(); inflight = null; return v; }).catch(() => { inflight = null; return cached; });
  return inflight;
}
