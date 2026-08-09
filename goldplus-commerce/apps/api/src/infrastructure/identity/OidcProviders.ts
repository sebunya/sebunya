import { createHash, createPrivateKey, createPublicKey, createVerify, randomBytes, sign as signCallback } from 'node:crypto';
import { promisify } from 'node:util';

const signAsync = promisify(signCallback) as (
  algorithm: string | null | undefined,
  data: Buffer,
  key: any,
) => Promise<Buffer>;

/**
 * Social sign-in, done as OpenID Connect for all three providers (2026-08-07).
 *
 * WHY OIDC AND NOT "log in with the token the browser gave us". A social login
 * is an authentication bypass surface: whatever this file accepts as proof of
 * identity IS the login. So the server does the whole thing itself —
 * authorization-code flow, code exchanged server-side, ID token signature
 * checked against the provider's published keys — and never trusts a
 * client-supplied assertion about who somebody is.
 *
 * Every defence here answers a specific attack:
 *   - `state`     — CSRF. Without it, an attacker completes a flow in your
 *                   browser and silently links their provider account to you.
 *   - `nonce`     — replay. Binds the ID token to THIS request, so a token
 *                   captured elsewhere cannot be posted back.
 *   - PKCE        — code interception. The code is worthless without the
 *                   verifier, which never leaves this server.
 *   - JWKS + iss/aud/exp — forgery. An unverified JWT is a claim, not proof.
 *
 * NOT CONFIGURED IS A REAL ANSWER. No provider credential exists in production,
 * so every provider below reports itself unconfigured and the routes refuse
 * honestly rather than half-working.
 */

import type { SocialProvider } from '../../domain/identity/SocialProvider';
export type { SocialProvider };

export interface OidcProviderConfig {
  provider: SocialProvider;
  displayName: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
  issuers: string[];
  scope: string;
  /** Apple returns the identity via POST, which changes the callback shape. */
  responseMode?: 'query' | 'form_post';
  /**
   * Whether an identity from this provider may be auto-linked to an EXISTING
   * password account that shares its verified email.
   *
   * Google and Apple assert a verified email we are willing to treat as proof
   * of control. Facebook is not auto-linked: its address can be attacker
   * controlled in ways that have historically been abused, and silently
   * merging it into an existing account would hand that account over. A
   * Facebook user with a matching email is asked to sign in and link
   * deliberately instead.
   */
  autoLinkOnVerifiedEmail: boolean;
}

export const OIDC_PROVIDERS: Record<SocialProvider, OidcProviderConfig> = {
  google: {
    provider: 'google',
    displayName: 'Google',
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
    issuers: ['https://accounts.google.com', 'accounts.google.com'],
    scope: 'openid email profile',
    responseMode: 'query',
    autoLinkOnVerifiedEmail: true,
  },
  apple: {
    provider: 'apple',
    displayName: 'Apple',
    authorizationEndpoint: 'https://appleid.apple.com/auth/authorize',
    tokenEndpoint: 'https://appleid.apple.com/auth/token',
    jwksUri: 'https://appleid.apple.com/auth/keys',
    issuers: ['https://appleid.apple.com'],
    scope: 'openid email name',
    // Apple POSTs the result back when name/email scopes are requested.
    responseMode: 'form_post',
    autoLinkOnVerifiedEmail: true,
  },
  facebook: {
    provider: 'facebook',
    displayName: 'Facebook',
    authorizationEndpoint: 'https://www.facebook.com/v18.0/dialog/oauth',
    tokenEndpoint: 'https://graph.facebook.com/v18.0/oauth/access_token',
    jwksUri: 'https://www.facebook.com/.well-known/oauth/openid/jwks/',
    issuers: ['https://www.facebook.com', 'https://facebook.com'],
    scope: 'openid email public_profile',
    responseMode: 'query',
    autoLinkOnVerifiedEmail: false,
  },
};

export interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
}

/** Apple's client secret is a short-lived ES256 JWT, not a static string. */
const buildAppleClientSecret = async (clientId: string): Promise<string | null> => {
  const teamId = (process.env.APPLE_TEAM_ID || '').trim();
  const keyId = (process.env.APPLE_KEY_ID || '').trim();
  const privateKeyPem = (process.env.APPLE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
  if (!teamId || !keyId || !privateKeyPem) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', kid: keyId, typ: 'JWT' };
  const claims = {
    iss: teamId,
    iat: now,
    exp: now + 15 * 60,
    aud: 'https://appleid.apple.com',
    sub: clientId,
  };
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput = `${encode(header)}.${encode(claims)}`;

  const key = createPrivateKey(privateKeyPem);
  const der = await signAsync('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${Buffer.from(der).toString('base64url')}`;
};

/**
 * Credentials for a provider, or null when it is not configured.
 * Reading them per call rather than at boot means an operator can add a
 * provider by setting variables and restarting, with no code change.
 */
export const providerCredentials = async (provider: SocialProvider): Promise<ProviderCredentials | null> => {
  const prefix = provider.toUpperCase();
  const clientId = (process.env[`${prefix}_CLIENT_ID`] || '').trim();
  if (!clientId) return null;

  if (provider === 'apple') {
    const secret = await buildAppleClientSecret(clientId);
    return secret ? { clientId, clientSecret: secret } : null;
  }

  const clientSecret = (process.env[`${prefix}_CLIENT_SECRET`] || '').trim();
  return clientSecret ? { clientId, clientSecret } : null;
};

export const isProviderConfigured = async (provider: SocialProvider): Promise<boolean> =>
  (await providerCredentials(provider)) !== null;

/* ── PKCE + state ────────────────────────────────────────────────────────── */

export const createPkcePair = (): { verifier: string; challenge: string } => {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
};

export const randomToken = (bytes = 24): string => randomBytes(bytes).toString('base64url');

/* ── ID token verification ───────────────────────────────────────────────── */

interface Jwk {
  kty: string;
  kid: string;
  use?: string;
  alg?: string;
  n?: string;
  e?: string;
  crv?: string;
  x?: string;
  y?: string;
}

const jwksCache = new Map<string, { fetchedAt: number; keys: Jwk[] }>();
const JWKS_TTL_MS = 10 * 60 * 1000;

const fetchJwks = async (uri: string): Promise<Jwk[]> => {
  const cached = jwksCache.get(uri);
  if (cached && Date.now() - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;

  const response = await fetch(uri, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`JWKS fetch failed: ${response.status}`);
  const body = (await response.json()) as { keys?: Jwk[] };
  const keys = body.keys ?? [];
  jwksCache.set(uri, { fetchedAt: Date.now(), keys });
  return keys;
};

const jwkToPem = (jwk: Jwk): any => {
  // node's createPublicKey accepts a JWK directly, which avoids hand-rolling
  // DER encoding — the classic place to introduce a signature-check bug.
  return createPublicKey({ key: jwk as any, format: 'jwk' });
};

export interface VerifiedIdentity {
  provider: SocialProvider;
  subject: string;
  email: string | null;
  emailVerified: boolean;
}

export type IdTokenVerification =
  | { ok: true; identity: VerifiedIdentity }
  | { ok: false; reason: string };

/**
 * Verify an ID token completely, or reject it. There is no partial acceptance:
 * an unverified JWT is a claim about identity, not proof of one.
 */
export const verifyIdToken = async (input: {
  idToken: string;
  provider: SocialProvider;
  clientId: string;
  expectedNonce: string;
  now?: number;
}): Promise<IdTokenVerification> => {
  const config = OIDC_PROVIDERS[input.provider];
  const parts = input.idToken.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'MALFORMED_TOKEN' };

  let header: { alg?: string; kid?: string };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'MALFORMED_TOKEN' };
  }

  // "alg: none" and HMAC confusion are the two classic JWT forgeries. Only
  // asymmetric algorithms are ever acceptable here.
  const alg = String(header.alg ?? '');
  if (!['RS256', 'ES256'].includes(alg)) return { ok: false, reason: 'UNSUPPORTED_ALG' };

  const keys = await fetchJwks(config.jwksUri);
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return { ok: false, reason: 'UNKNOWN_KEY' };

  const verifier = createVerify(alg === 'ES256' ? 'sha256' : 'RSA-SHA256');
  verifier.update(`${parts[0]}.${parts[1]}`);
  verifier.end();
  const signatureValid = verifier.verify(
    alg === 'ES256'
      ? { key: jwkToPem(jwk), dsaEncoding: 'ieee-p1363' as const }
      : jwkToPem(jwk),
    Buffer.from(parts[2], 'base64url'),
  );
  if (!signatureValid) return { ok: false, reason: 'BAD_SIGNATURE' };

  const now = Math.floor((input.now ?? Date.now()) / 1000);
  if (typeof claims.exp !== 'number' || claims.exp <= now) return { ok: false, reason: 'EXPIRED' };
  if (typeof claims.iat === 'number' && claims.iat > now + 300) return { ok: false, reason: 'ISSUED_IN_FUTURE' };
  if (!config.issuers.includes(String(claims.iss ?? ''))) return { ok: false, reason: 'BAD_ISSUER' };

  const audience = Array.isArray(claims.aud) ? claims.aud.map(String) : [String(claims.aud ?? '')];
  if (!audience.includes(input.clientId)) return { ok: false, reason: 'BAD_AUDIENCE' };

  // Replay protection: this token must belong to the flow we started.
  if (String(claims.nonce ?? '') !== input.expectedNonce) return { ok: false, reason: 'BAD_NONCE' };

  const subject = String(claims.sub ?? '');
  if (!subject) return { ok: false, reason: 'NO_SUBJECT' };

  const email = typeof claims.email === 'string' && claims.email.includes('@') ? claims.email.toLowerCase() : null;
  // Providers send this as a boolean or the string "true" depending on vintage.
  const emailVerified = claims.email_verified === true || claims.email_verified === 'true';

  return {
    ok: true,
    identity: { provider: input.provider, subject, email, emailVerified },
  };
};

/** Exchange the authorization code for tokens, server-side, with PKCE. */
export const exchangeCodeForIdToken = async (input: {
  provider: SocialProvider;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  credentials: ProviderCredentials;
}): Promise<{ ok: true; idToken: string } | { ok: false; reason: string }> => {
  const config = OIDC_PROVIDERS[input.provider];
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.credentials.clientId,
    client_secret: input.credentials.clientSecret,
    code_verifier: input.codeVerifier,
  });

  const response = await fetch(config.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    signal: AbortSignal.timeout(8000),
  });

  if (!response.ok) return { ok: false, reason: `TOKEN_EXCHANGE_${response.status}` };
  const payload = (await response.json().catch(() => null)) as { id_token?: string } | null;
  if (!payload?.id_token) return { ok: false, reason: 'NO_ID_TOKEN' };
  return { ok: true, idToken: payload.id_token };
};

/** Build the provider's authorization URL for the start of the flow. */
export const buildAuthorizationUrl = (input: {
  provider: SocialProvider;
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}): string => {
  const config = OIDC_PROVIDERS[input.provider];
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: config.scope,
    state: input.state,
    nonce: input.nonce,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
  });
  if (config.responseMode === 'form_post') params.set('response_mode', 'form_post');
  return `${config.authorizationEndpoint}?${params.toString()}`;
};
