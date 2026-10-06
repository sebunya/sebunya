import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * "Connect Spotify", the browser half (2026-10-06). OAuth authorization code
 * with PKCE, as Spotify's own tooling does it (spotify/ads-agentic-tools,
 * configure/scripts/oauth-flow.py): client ID + S256 code challenge, no
 * client secret anywhere. The redirect URI registered on the GoldPlus Ads app
 * must match exactly, so it is written once, here.
 */
export const SPOTIFY_REDIRECT_PATH = '/admin/advertising/spotify/callback';
export const SPOTIFY_COOKIE_PATH = '/admin/advertising/spotify';
export const SPOTIFY_STATE_COOKIE = 'gp_spotify_state';
export const SPOTIFY_VERIFIER_COOKIE = 'gp_spotify_verifier';
export const SPOTIFY_RESULT_COOKIE = 'gp_spotify_result';
/** Ten minutes from "Continue to Spotify" to the return. */
export const SPOTIFY_FLOW_SECONDS = 10 * 60;

export const isSpotifyClientId = (v: string) => /^[0-9a-f]{32}$/.test(v);
export const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export const isSpotifyCode = (v: string) => /^[A-Za-z0-9_-]{10,1000}$/.test(v);

/** RFC 7636: a 64-character verifier and its S256 challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url'); // 64 chars
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function spotifyAuthoriseUrl(clientId: string, challenge: string, state: string, siteOrigin: string): string {
  const q = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: `${siteOrigin}${SPOTIFY_REDIRECT_PATH}`,
    code_challenge_method: 'S256', code_challenge: challenge, state,
  });
  return `https://accounts.spotify.com/authorize?${q.toString()}`;
}

/** The state Spotify sent back is the one this browser was given (constant-time; empty never matches). */
export function sameState(sent: string | null | undefined, kept: string | null | undefined): boolean {
  if (!sent || !kept || sent.length !== kept.length || sent.length < 16) return false;
  return timingSafeEqual(Buffer.from(sent), Buffer.from(kept));
}

/** A saved setting of the spotify:ads_api capability, as GET /capabilities lists it. */
export function spotifyField(capability: { fields?: Array<{ key: string; value?: unknown }> } | null | undefined, key: string): string {
  return String(capability?.fields?.find((f) => f.key === key)?.value ?? '').trim();
}
