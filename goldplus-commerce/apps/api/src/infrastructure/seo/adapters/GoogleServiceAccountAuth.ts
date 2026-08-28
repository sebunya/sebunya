import { createSign } from 'node:crypto';

/**
 * GoogleServiceAccountAuth — RS256 JWT-bearer token exchange for any Google
 * scope, from a service-account JSON key (no googleapis dependency, matching
 * GscClient's house style). Tokens are cached per (client_email, scope) until
 * 60s before expiry.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export class GoogleAuthError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'GoogleAuthError';
  }
}

const b64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url');

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export interface ServiceAccountKey { client_email: string; private_key: string }

export function parseServiceAccountJson(raw: unknown): ServiceAccountKey {
  let parsed: any = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { throw new GoogleAuthError('Service-account JSON is not valid JSON.', 0); }
  }
  if (!parsed?.client_email || !parsed?.private_key) {
    throw new GoogleAuthError('Service-account JSON must contain client_email and private_key.', 0);
  }
  return { client_email: String(parsed.client_email), private_key: String(parsed.private_key) };
}

export async function getServiceAccountToken(key: ServiceAccountKey, scope: string): Promise<string> {
  const cacheKey = `${key.client_email}|${scope}`;
  const now = Date.now();
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt - 60_000 > now) return cached.token;

  const nowSec = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: key.client_email, scope, aud: TOKEN_URL, iat: nowSec, exp: nowSec + 3600 }));
  const unsigned = `${header}.${claims}`;
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  let signature: string;
  try {
    signature = signer.sign(key.private_key).toString('base64url');
  } catch {
    throw new GoogleAuthError('Service-account private_key could not sign (malformed key).', 0);
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    // A hung provider must not hold this request open forever.
    signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${signature}`,
    }).toString(),
  });
  if (!res.ok) throw new GoogleAuthError(`Google token exchange failed (${res.status}).`, res.status);
  const body = await res.json() as { access_token: string; expires_in: number };
  tokenCache.set(cacheKey, { token: body.access_token, expiresAt: now + body.expires_in * 1000 });
  return body.access_token;
}
