/** Spotify's OAuth token endpoint and Ads API, as the connect flow needs them. */
export type SpotifyResult<T> = ({ ok: true } & T) | { ok: false; message: string; status?: number };

export interface SpotifyAdsGateway {
  /** authorization_code + PKCE: client ID and the code verifier, no client secret. */
  exchangeCode(input: { clientId: string; code: string; codeVerifier: string; redirectUri: string }): Promise<SpotifyResult<{ accessToken: string; refreshToken: string }>>;
  /** GET /ads/v3/ad_accounts/{id}: proves the token can read the account. */
  readAdAccount(accessToken: string, adAccountId: string): Promise<SpotifyResult<{ name: string | null }>>;
}
