const COOKIE_NAME = 'goldplus_session';
const REFRESH_COOKIE_NAME = 'goldplus_refresh';

/**
 * Sessions (2026-10-07): the session cookie holds a SHORT access token (15 min)
 * and goldplus_refresh holds the refresh credential (30 days, rotated on every
 * use). The middleware renews the access token before a page runs and records
 * the new one here, keyed by the request, so every readSessionToken(Astro.request)
 * on that request sees the renewed token, not the expired cookie value.
 */
const renewed = new WeakMap<Request, string | null>();

/** Record the access token for this request (null: signed out by the renewal). */
export function setRequestSessionToken(request: Request, token: string | null): void {
  renewed.set(request, token);
}

function readCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) {
      const v = rest.join('=').trim();
      return v || null;
    }
  }
  return null;
}

export function readRefreshToken(request: Request): string | null {
  return readCookie(request, REFRESH_COOKIE_NAME);
}

/** Seconds until a JWT's exp (negative when past), or null when it cannot be read. Not a verification. */
export function tokenSecondsLeft(token: string, nowMs = Date.now()): number | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'));
    return typeof payload?.exp === 'number' ? payload.exp - Math.floor(nowMs / 1000) : null;
  } catch {
    return null;
  }
}

type CookieJar = { set(name: string, value: string, opts: Record<string, unknown>): void; delete(name: string, opts: Record<string, unknown>): void };

/**
 * Set the sign-in cookies from an API token response. The session cookie lives
 * as long as the refresh credential (the token inside expires on its own and
 * is renewed); without a refresh credential it keeps the old 7-day lifetime.
 */
export function setSignInCookies(cookies: CookieJar, data: { token: string; refreshToken?: string; refreshExpiresAt?: string }): void {
  const secure = import.meta.env.PROD;
  const refreshMaxAge = data.refreshExpiresAt
    ? Math.max(60, Math.floor((Date.parse(data.refreshExpiresAt) - Date.now()) / 1000))
    : null;
  cookies.set(COOKIE_NAME, data.token, { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: refreshMaxAge ?? 604800 });
  if (data.refreshToken && refreshMaxAge) {
    cookies.set(REFRESH_COOKIE_NAME, data.refreshToken, { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: refreshMaxAge });
  }
}

/** The same cookies as raw Set-Cookie values, for routes that build their own Response. */
export function signInCookieHeaders(data: { token: string; refreshToken?: string; refreshExpiresAt?: string }): string[] {
  const secure = import.meta.env.PROD ? '; Secure' : '';
  const refreshMaxAge = data.refreshExpiresAt
    ? Math.max(60, Math.floor((Date.parse(data.refreshExpiresAt) - Date.now()) / 1000))
    : null;
  const out = [`${COOKIE_NAME}=${data.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${refreshMaxAge ?? 604800}${secure}`];
  if (data.refreshToken && refreshMaxAge) {
    out.push(`${REFRESH_COOKIE_NAME}=${data.refreshToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${refreshMaxAge}${secure}`);
  }
  return out;
}

export function clearSignInCookies(cookies: CookieJar): void {
  cookies.delete(COOKIE_NAME, { path: '/' });
  cookies.delete(REFRESH_COOKIE_NAME, { path: '/' });
}

export function readSessionToken(request: Request): string | null {
  if (renewed.has(request)) return renewed.get(request) ?? null;
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === COOKIE_NAME) {
      const v = rest.join('=').trim();
      return v || null;
    }
  }
  return null;
}

export function sessionCookieValue(token: string): string {
  const isProd = import.meta.env.PROD;
  const attrs = [
    `${COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=604800', // 7 days
  ];
  if (isProd) attrs.push('Secure');
  return attrs.join('; ');
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function clearRefreshCookie(): string {
  return `${REFRESH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
export const REFRESH_SESSION_COOKIE_NAME = REFRESH_COOKIE_NAME;
