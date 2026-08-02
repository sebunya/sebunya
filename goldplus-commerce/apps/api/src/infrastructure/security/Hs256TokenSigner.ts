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
  exp: number;
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

  async sign(payload: { subject: string; email: string; ttlSeconds: number }): Promise<string> {
    if (!this.secret) {
      throw new Error('JWT_SECRET is not configured (minimum 32 characters).');
    }
    const now = Math.floor(Date.now() / 1000);
    const body: JwtPayload = {
      sub: payload.subject,
      email: payload.email,
      iat: now,
      exp: now + payload.ttlSeconds,
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
      issuedAt: new Date(payload.iat * 1000),
    };
  }
}
