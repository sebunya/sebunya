import { Context, Next } from 'hono';
import { logger } from '../../../infrastructure/logging/logger';
import { decideCsrf } from '../../../domain/security/CsrfPolicy';

/**
 * CSRF defence for cookie-authenticated mutations (Slice 3B).
 *
 * The allowlist of web origins is read once from the environment. This is a
 * bootstrap/adapter boundary, so reading process.env here is allowed; Slice 3D
 * will fold it into the typed config. PUBLIC_API_BASE_URL always counts, and
 * CSRF_ALLOWED_ORIGINS adds the storefront/admin web origins (comma-separated).
 */
function allowlist(): string[] {
  const raw = [process.env.PUBLIC_API_BASE_URL, ...(process.env.CSRF_ALLOWED_ORIGINS ?? '').split(',')]
    .map((s) => (s ?? '').trim())
    .filter(Boolean);
  return Array.from(new Set(raw));
}

export function csrf() {
  return async (c: Context, next: Next) => {
    // Hermetic unit suite drives mutations without browser headers; the policy
    // itself is unit-tested directly. Mirrors the abuse-control middleware.
    if (process.env.NODE_ENV === 'test') {
      return next();
    }

    const decision = decideCsrf({
      method: c.req.method,
      path: c.req.path,
      cookieHeader: c.req.header('cookie'),
      originHeader: c.req.header('origin'),
      refererHeader: c.req.header('referer'),
      allowlist: allowlist(),
    });

    if (decision.action === 'BLOCK') {
      logger.warn(
        { path: c.req.path, method: c.req.method, reason: decision.reason },
        '[CSRF] Blocked cross-origin cookie-authenticated mutation',
      );
      return c.json(
        { success: false, error: { code: 'CSRF_FAILED', message: 'Cross-site request blocked.' } },
        403,
      );
    }

    await next();
  };
}
