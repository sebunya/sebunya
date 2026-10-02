import { timingSafeEqual } from 'node:crypto';

/**
 * TikTok advertiser authorisation, the browser half (2026-10-02). The address
 * registered with TikTok as the app's "Advertiser redirect URL" must match
 * exactly, so it is written once, here.
 */
export const TIKTOK_REDIRECT_PATH = '/admin/advertising/tiktok/callback';
export const TIKTOK_STATE_COOKIE = 'gp_tiktok_state';
export const TIKTOK_CODE_COOKIE = 'gp_tiktok_code';
export const TIKTOK_COOKIE_PATH = '/admin/advertising/tiktok';
/** TikTok's code is valid for one hour; so is the state it answers. */
export const TIKTOK_FLOW_SECONDS = 60 * 60;

export const isTikTokAppId = (v: string) => /^\d{10,25}$/.test(v);
export const isTikTokAuthCode = (v: string) => /^[A-Za-z0-9_-]{10,300}$/.test(v);

/** The page TikTok shows the advertiser to approve the app. */
export function tiktokAuthoriseUrl(appId: string, state: string, siteOrigin: string): string {
  const q = new URLSearchParams({ app_id: appId, state, redirect_uri: `${siteOrigin}${TIKTOK_REDIRECT_PATH}` });
  return `https://business-api.tiktok.com/portal/auth?${q.toString()}`;
}

/** The state TikTok sent back is the one this browser was given (constant-time; empty never matches). */
export function sameState(sent: string | null | undefined, kept: string | null | undefined): boolean {
  if (!sent || !kept || sent.length !== kept.length || sent.length < 16) return false;
  return timingSafeEqual(Buffer.from(sent), Buffer.from(kept));
}

/** A saved setting of the TikTok audiences capability, as the admin API lists it (`fields[].value`). */
export function tiktokField(capability: { fields?: Array<{ key: string; value?: unknown }> } | null | undefined, key: string): string {
  return String(capability?.fields?.find((f) => f.key === key)?.value ?? '').trim();
}
