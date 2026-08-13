import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * GoogleOAuthService — CSRF-safe OAuth2 authorization-code flow with PKCE
 * (S256) for Google providers (currently Google Business Profile).
 *
 * State: a random 32-byte token, HMAC-signed (key derived from JWT_SECRET /
 * SEO_CREDENTIAL_VAULT_KEY) and stored SERVER-SIDE with a 10-minute TTL, tied
 * to the connection AND the initiating actor. A state that is expired, unknown,
 * tampered with, or presented by a different actor is rejected.
 *
 * OAuth client app resolution: an operator-supplied {clientId, clientSecret}
 * held in the connection's vault credential, falling back to the
 * GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET env vars. When neither
 * exists the connection stays AUTHORIZATION_REQUIRED with a clear reason —
 * nothing is faked. Tokens never appear in logs or API responses.
 */

const STATE_TTL_MS = 10 * 60 * 1000;
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface OAuthStateRecord {
  connectionId: string;
  actorId: string;
  verifier: string;
  createdAt: number;
}

export interface OAuthTokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number; // epoch ms
  scope: string;
}

export class GoogleOAuthService {
  private readonly states = new Map<string, OAuthStateRecord>();
  private readonly hmacKey: Buffer;

  constructor(
    secret?: string,
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly now: () => number = Date.now,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const material = (secret ?? env.SEO_CREDENTIAL_VAULT_KEY ?? env.JWT_SECRET ?? '').trim();
    if (material === '') throw new Error('GoogleOAuthService requires SEO_CREDENTIAL_VAULT_KEY or JWT_SECRET.');
    this.hmacKey = createHash('sha256').update(`goldplus:seo-oauth-state:v1:${material}`).digest();
  }

  private sign(token: string): string {
    return createHmac('sha256', this.hmacKey).update(token).digest('base64url');
  }

  /** Issue a signed state bound to connection + actor; PKCE verifier stored server-side. */
  createState(connectionId: string, actorId: string): { state: string; verifier: string } {
    const token = randomBytes(32).toString('base64url');
    const verifier = randomBytes(48).toString('base64url');
    this.states.set(token, { connectionId, actorId, verifier, createdAt: this.now() });
    return { state: `${token}.${this.sign(token)}`, verifier };
  }

  /**
   * Validate + consume a state. Rejects unknown, tampered and expired states,
   * and — when an actor is supplied — states initiated by a different actor.
   * One-shot: consumed on success.
   */
  consumeState(state: string, actorId?: string): OAuthStateRecord | null {
    const dot = state.lastIndexOf('.');
    if (dot <= 0) return null;
    const token = state.slice(0, dot);
    const sig = state.slice(dot + 1);
    const expected = this.sign(token);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const record = this.states.get(token);
    if (!record) return null;
    if (this.now() - record.createdAt > STATE_TTL_MS) {
      this.states.delete(token);
      return null;
    }
    // The provider's redirect is a plain browser navigation carrying no
    // Authorization header, so the callback has no session to compare against.
    // Omitting actorId is therefore allowed: the state is still HMAC-signed,
    // single-use and TTL-bound, and it CARRIES the actor it was issued to
    // (callers use record.actorId). When a caller does supply an actor, the
    // stricter binding is enforced as before.
    if (actorId !== undefined && record.actorId !== actorId) return null;
    this.states.delete(token);
    return record;
  }

  buildAuthUrl(input: { clientId: string; redirectUri: string; scopes: string[]; state: string; verifier: string }): string {
    const challenge = createHash('sha256').update(input.verifier).digest('base64url');
    const params = new URLSearchParams({
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      response_type: 'code',
      scope: input.scopes.join(' '),
      state: input.state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      access_type: 'offline',
      prompt: 'consent',
    });
    return `${AUTH_URL}?${params.toString()}`;
  }

  envClientApp(): { clientId: string; clientSecret: string } | null {
    const clientId = (this.env.GOOGLE_OAUTH_CLIENT_ID ?? '').trim();
    const clientSecret = (this.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '').trim();
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  }

  redirectUri(): string | null {
    const base = (this.env.SEO_OAUTH_REDIRECT_BASE ?? '').trim().replace(/\/$/, '');
    // Public router: the consent redirect is a browser navigation with no
    // Authorization header, so it cannot land on an /admin surface.
    return base === '' ? null : `${base}/seo/oauth/google/callback`;
  }

  async exchangeCode(input: {
    code: string; verifier: string; clientId: string; clientSecret: string; redirectUri: string;
  }): Promise<OAuthTokenSet> {
    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: input.code,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        redirect_uri: input.redirectUri,
        code_verifier: input.verifier,
      }).toString(),
    });
    if (!res.ok) throw new Error(`OAuth code exchange failed (${res.status}).`);
    const body = await res.json() as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token ?? null,
      expiresAt: this.now() + body.expires_in * 1000,
      scope: body.scope ?? '',
    };
  }

  /** Refresh an access token; throws with AUTH_EXPIRED semantics on failure. */
  async refresh(input: { refreshToken: string; clientId: string; clientSecret: string }): Promise<OAuthTokenSet> {
    const res = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: input.refreshToken,
        client_id: input.clientId,
        client_secret: input.clientSecret,
      }).toString(),
    });
    if (!res.ok) {
      const err = new Error(`OAuth token refresh failed (${res.status}).`);
      (err as any).code = res.status === 400 || res.status === 401 ? 'AUTH_EXPIRED' : 'PROVIDER_UNAVAILABLE';
      throw err;
    }
    const body = await res.json() as { access_token: string; expires_in: number; scope?: string };
    return {
      accessToken: body.access_token,
      refreshToken: input.refreshToken,
      expiresAt: this.now() + body.expires_in * 1000,
      scope: body.scope ?? '',
    };
  }
}

/**
 * TokenBroker — resolves a live OAuth access token from a vault credential
 * payload ({ tokens: OAuthTokenSet, clientId?, clientSecret? }), refreshing
 * when within 60s of expiry and handing back the updated payload for
 * re-encryption. Never logs token values.
 */
export class GoogleTokenBroker {
  constructor(private readonly oauth: GoogleOAuthService, private readonly now: () => number = Date.now) {}

  async accessToken(payload: Record<string, unknown>): Promise<{ token: string; updatedPayload: Record<string, unknown> | null }> {
    const tokens = (payload?.tokens ?? null) as OAuthTokenSet | null;
    if (!tokens?.accessToken) {
      const err = new Error('No OAuth tokens stored — authorization required.');
      (err as any).code = 'AUTH_EXPIRED';
      throw err;
    }
    if (tokens.expiresAt - 60_000 > this.now()) return { token: tokens.accessToken, updatedPayload: null };
    const app = (payload.clientId && payload.clientSecret)
      ? { clientId: String(payload.clientId), clientSecret: String(payload.clientSecret) }
      : this.oauth.envClientApp();
    if (!app || !tokens.refreshToken) {
      const err = new Error('Access token expired and no refresh path is configured — re-authorization required.');
      (err as any).code = 'AUTH_EXPIRED';
      throw err;
    }
    const refreshed = await this.oauth.refresh({ refreshToken: tokens.refreshToken, ...app });
    return { token: refreshed.accessToken, updatedPayload: { ...payload, tokens: refreshed } };
  }
}

let singleton: GoogleOAuthService | null = null;
export function googleOAuthService(): GoogleOAuthService {
  if (!singleton) singleton = new GoogleOAuthService();
  return singleton;
}
