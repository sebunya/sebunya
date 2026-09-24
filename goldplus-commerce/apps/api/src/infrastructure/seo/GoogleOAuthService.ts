import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * GoogleOAuthService — CSRF-safe OAuth2 authorization-code flow with PKCE
 * (S256) for Google providers (currently Google Business Profile).
 *
 * State: {connectionId, actorId, PKCE verifier, issued-at, nonce} SEALED with
 * AES-256-GCM (key derived from SEO_CREDENTIAL_VAULT_KEY / JWT_SECRET) and carried
 * in the state parameter itself, with a 10-minute TTL, tied to the connection AND
 * the initiating actor. A state that is expired, tampered with, or presented by a
 * different actor is rejected.
 *
 * Why sealed rather than stored: the API runs two replicas behind Caddy, and the
 * state used to live in the Map of whichever replica served /start. Google's
 * callback reached the other replica about half the time, found nothing, and the
 * one-time authorization code was thrown away as invalid_state; any deploy between
 * start and callback lost every pending state. Google's code is single-use and
 * PKCE-bound, so a replayed state yields nothing; a per-process consumed-nonce
 * list still refuses an immediate replay on the same replica.
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
  /** nonce -> expiry, best-effort single use on this replica. */
  private readonly consumed = new Map<string, number>();
  private readonly sealKey: Buffer;

  constructor(
    secret?: string,
    private readonly env: Record<string, string | undefined> = process.env,
    private readonly now: () => number = Date.now,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    const material = (secret ?? env.SEO_CREDENTIAL_VAULT_KEY ?? env.JWT_SECRET ?? '').trim();
    if (material === '') throw new Error('GoogleOAuthService requires SEO_CREDENTIAL_VAULT_KEY or JWT_SECRET.');
    // A new context label: the sealing key is unrelated to every other key drawn
    // from the same material.
    this.sealKey = createHash('sha256').update(`goldplus:seo-oauth-state-seal:v2:${material}`).digest();
  }

  /** Issue a sealed state bound to connection + actor, carrying its PKCE verifier. */
  createState(connectionId: string, actorId: string): { state: string; verifier: string } {
    const verifier = randomBytes(48).toString('base64url');
    const nonce = randomBytes(12).toString('base64url');
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.sealKey, iv);
    const plain = JSON.stringify({ c: connectionId, a: actorId, v: verifier, t: this.now(), n: nonce });
    const sealed = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    return { state: `v2.${iv.toString('base64url')}.${sealed.toString('base64url')}`, verifier };
  }

  private unseal(state: string): (OAuthStateRecord & { nonce: string }) | null {
    const parts = state.split('.');
    if (parts.length !== 3 || parts[0] !== 'v2') return null;
    try {
      const iv = Buffer.from(parts[1], 'base64url');
      const sealed = Buffer.from(parts[2], 'base64url');
      if (iv.length !== 12 || sealed.length <= 16) return null;
      const decipher = createDecipheriv('aes-256-gcm', this.sealKey, iv);
      decipher.setAuthTag(sealed.subarray(sealed.length - 16));
      const plain = Buffer.concat([decipher.update(sealed.subarray(0, sealed.length - 16)), decipher.final()]).toString('utf8');
      const body = JSON.parse(plain) as { c?: unknown; a?: unknown; v?: unknown; t?: unknown; n?: unknown };
      if (typeof body.c !== 'string' || typeof body.a !== 'string' || typeof body.v !== 'string'
        || typeof body.t !== 'number' || typeof body.n !== 'string') return null;
      return { connectionId: body.c, actorId: body.a, verifier: body.v, createdAt: body.t, nonce: body.n };
    } catch {
      // Tampered, truncated, or sealed under another key: all the same answer.
      return null;
    }
  }

  /**
   * Validate + consume a state. Rejects unknown, tampered and expired states,
   * and — when an actor is supplied — states initiated by a different actor.
   * One-shot: consumed on success.
   */
  consumeState(state: string, actorId?: string): OAuthStateRecord | null {
    const unsealed = this.unseal(state);
    if (!unsealed) return null;
    const now = this.now();
    for (const [nonce, expires] of this.consumed) if (expires <= now) this.consumed.delete(nonce);
    if (now - unsealed.createdAt > STATE_TTL_MS || unsealed.createdAt - now > 60_000) return null;
    if (this.consumed.has(unsealed.nonce)) return null;
    // The provider's redirect is a plain browser navigation carrying no
    // Authorization header, so the callback has no session to compare against.
    // Omitting actorId is therefore allowed: the state is still HMAC-signed,
    // single-use and TTL-bound, and it CARRIES the actor it was issued to
    // (callers use record.actorId). When a caller does supply an actor, the
    // stricter binding is enforced as before.
    if (actorId !== undefined && unsealed.actorId !== actorId) return null;
    this.consumed.set(unsealed.nonce, unsealed.createdAt + STATE_TTL_MS);
    const { nonce: _nonce, ...record } = unsealed;
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
