/** TikTok's answer to exchanging an authorisation code. The token is returned to the caller only; it is never logged. */
export type TikTokTokenAnswer = { ok: true; accessToken: string; advertiserIds: string[] } | { ok: false; message: string };

/**
 * The one server-side step of TikTok's advertiser authorisation: the code
 * TikTok appends to the redirect URL is exchanged, with the app's ID and
 * secret, for a long-term Marketing API access token.
 */
export interface TikTokOAuthGateway {
  exchange(appId: string, appSecret: string, authCode: string): Promise<TikTokTokenAnswer>;
}
