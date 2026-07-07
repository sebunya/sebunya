import { Context, Next } from 'hono';

/**
 * Baseline security response headers applied to every API response.
 * The API returns JSON only (no HTML), so a strict, script-free CSP is
 * safe and blocks a whole class of injection/clickjacking attacks.
 */
export async function securityHeaders(c: Context, next: Next): Promise<void> {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'no-referrer');
  c.header('Cross-Origin-Resource-Policy', 'same-site');
  c.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()');
  c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
  // Only advertise HSTS over real HTTPS deployments.
  if (process.env.NODE_ENV === 'production') {
    c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }
}
