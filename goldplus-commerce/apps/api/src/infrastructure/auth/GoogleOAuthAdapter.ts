import { ISocialIdentityProvider, SocialProfileResult } from '../../application/ports/IUserIdentityRepository';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const USERINFO_ENDPOINT = 'https://openidconnect.googleapis.com/v1/userinfo';
const REQUEST_TIMEOUT_MS = 10_000;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * Google OAuth 2.0 / OpenID Connect adapter (authorization code flow).
 *
 * "No fake integrations": with credentials missing, isConfigured() is
 * false, getAuthorizationUrl() returns null, and fetchProfile() returns
 * NOT_CONFIGURED — nothing pretends to work.
 *
 * The profile comes from Google's OpenID userinfo endpoint using the
 * access token from the code exchange — the token is served directly by
 * Google over TLS, so no local JWT signature verification is required.
 */
export class GoogleOAuthAdapter implements ISocialIdentityProvider {
  public readonly provider = 'google';

  constructor(private readonly fetchFn: FetchLike = (input, init) => fetch(input, init)) {}

  private credentials(): { clientId: string; clientSecret: string; redirectUri: string } | null {
    const clientId = (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
    const clientSecret = (process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
    const redirectUri = (process.env.GOOGLE_OAUTH_REDIRECT_URI || '').trim();
    if (!clientId || !clientSecret || !redirectUri) return null;
    return { clientId, clientSecret, redirectUri };
  }

  isConfigured(): boolean {
    return this.credentials() !== null;
  }

  getAuthorizationUrl(state: string): string | null {
    const creds = this.credentials();
    if (!creds) return null;
    const params = new URLSearchParams({
      client_id: creds.clientId,
      redirect_uri: creds.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      access_type: 'online',
      prompt: 'select_account',
    });
    return `${AUTH_ENDPOINT}?${params.toString()}`;
  }

  async fetchProfile(code: string): Promise<SocialProfileResult> {
    const creds = this.credentials();
    if (!creds) {
      return {
        ok: false,
        code: 'NOT_CONFIGURED',
        message: 'Google sign-in is not configured (GOOGLE_OAUTH_CLIENT_ID / _SECRET / _REDIRECT_URI missing).',
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const tokenResponse = await this.fetchFn(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          redirect_uri: creds.redirectUri,
          grant_type: 'authorization_code',
        }).toString(),
        signal: controller.signal,
      });

      const tokenBody: any = await tokenResponse.json().catch(() => null);
      if (!tokenResponse.ok || !tokenBody?.access_token) {
        const detail = tokenBody?.error_description || tokenBody?.error || tokenResponse.statusText;
        return { ok: false, code: 'EXCHANGE_FAILED', message: `Google code exchange failed: ${detail}` };
      }

      const profileResponse = await this.fetchFn(USERINFO_ENDPOINT, {
        headers: { Authorization: `Bearer ${tokenBody.access_token}` },
        signal: controller.signal,
      });
      const profile: any = await profileResponse.json().catch(() => null);
      if (!profileResponse.ok || !profile?.sub || !profile?.email) {
        return { ok: false, code: 'EXCHANGE_FAILED', message: 'Google userinfo request failed.' };
      }

      return {
        ok: true,
        profile: {
          providerUserId: String(profile.sub),
          email: String(profile.email),
          emailVerified: profile.email_verified === true || profile.email_verified === 'true',
          name: profile.name ? String(profile.name) : null,
        },
      };
    } catch (err: any) {
      const timedOut = err?.name === 'AbortError';
      return {
        ok: false,
        code: 'EXCHANGE_FAILED',
        message: timedOut ? 'Google OAuth request timed out.' : `Google OAuth request failed: ${err?.message || 'unknown error'}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
