import { createHmac, timingSafeEqual } from 'node:crypto';
import { ITokenSigner, VerifiedToken } from '../../application/ports/ITokenSigner';

function base64UrlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(s: string): Buffer {
  const pad = s.length % 4 === 2 ? '==' : s.length % 4 === 3 ? '=' : '';
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

interface JwtPayload {
  sub: string;
  email: string;
  iat: number;
  /**
   * The issue instant in milliseconds. `iat` is whole seconds (RFC 7519), so on its own a revocation cut-off cannot
   * tell a token issued just before a password reset from one issued just after it in the same second. Revocation
   * compares this exact instant; a token without it (signed before this claim existed) falls back to `iat`.
   */
  iat_ms?: number;
  exp: number;
  /** The sign-in session (refresh-token family), so a step-up counts for that session only (0187). */
  sid?: string;
}

/** The exact issue instant: iat_ms when it agrees with iat (same second), else the start of iat's second. */
function issuedAtMs(payload: JwtPayload): number {
  const fromSeconds = payload.iat * 1000;
  const ms = payload.iat_ms;
  if (typeof ms === 'number' && Number.isFinite(ms) && ms >= fromSeconds && ms < fromSeconds + 1000) return ms;
  return fromSeconds;
}

export class Hs256TokenSigner implements ITokenSigner {
  private readonly secret: string | null;
  /**
   * Optional previous signing secret, honoured only for VERIFY (never sign).
   * This is the safe JWT-rotation window (§14): after rotating JWT_SECRET, live
   * sessions signed with the old secret keep verifying until they expire, so a
   * rotation does not force every user to re-login at once. Remove
   * JWT_SECRET_PREVIOUS once the access-token TTL has elapsed to close the window.
   */
  private readonly previousSecret: string | null;
  constructor(
    secret: string | undefined = process.env.JWT_SECRET,
    previousSecret: string | undefined = process.env.JWT_SECRET_PREVIOUS,
  ) {
    const trimmed = (secret ?? '').trim();
    this.secret = trimmed.length >= 32 ? trimmed : null;
    const prev = (previousSecret ?? '').trim();
    this.previousSecret = prev.length >= 32 ? prev : null;
  }

  /** Whether the signature matches the current OR the previous secret. */
  private signatureMatches(signingInput: string, provided: Buffer): boolean {
    for (const secret of [this.secret, this.previousSecret]) {
      if (!secret) continue;
      const expected = createHmac('sha256', secret).update(signingInput).digest();
      if (provided.length === expected.length && timingSafeEqual(provided, expected)) return true;
    }
    return false;
  }

  isConfigured(): boolean {
    return this.secret !== null;
  }

  async sign(payload: { subject: string; email: string; ttlSeconds: number; sessionId?: string }): Promise<string> {
    if (!this.secret) {
      throw new Error('JWT_SECRET is not configured (minimum 32 characters).');
    }
    const nowMs = Date.now();
    const now = Math.floor(nowMs / 1000);
    const body: JwtPayload = {
      sub: payload.subject,
      email: payload.email,
      iat: now,
      iat_ms: nowMs,
      exp: now + payload.ttlSeconds,
      ...(payload.sessionId ? { sid: payload.sessionId } : {}),
    };
    const header = base64UrlEncode(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
    const payloadEncoded = base64UrlEncode(Buffer.from(JSON.stringify(body)));
    const signingInput = `${header}.${payloadEncoded}`;
    const sig = createHmac('sha256', this.secret).update(signingInput).digest();
    return `${signingInput}.${base64UrlEncode(sig)}`;
  }

  async verify(token: string): Promise<VerifiedToken | null> {
    if (!this.secret || !token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;

    let signatureProvided: Buffer;
    try {
      signatureProvided = base64UrlDecode(sigB64);
    } catch {
      return null;
    }

    // Verify against the current OR the previous secret (rotation window).
    if (!this.signatureMatches(`${headerB64}.${payloadB64}`, signatureProvided)) return null;

    let payload: JwtPayload;
    try {
      payload = JSON.parse(base64UrlDecode(payloadB64).toString('utf8'));
    } catch {
      return null;
    }

    const now = Math.floor(Date.now() / 1000);
    if (typeof payload.exp !== 'number' || payload.exp < now) return null;
    if (typeof payload.iat !== 'number' || payload.iat > now + 60) return null; // 60s clock skew
    if (typeof payload.sub !== 'string' || !payload.sub) return null;
    if (typeof payload.email !== 'string' || !payload.email) return null;

    return {
      subject: payload.sub,
      email: payload.email,
      expiresAt: new Date(payload.exp * 1000),
      issuedAt: new Date(issuedAtMs(payload)),
      ...(typeof payload.sid === 'string' && payload.sid ? { sessionId: payload.sid } : {}),
    };
  }
}
