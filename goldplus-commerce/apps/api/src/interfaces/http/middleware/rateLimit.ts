import { Context, Next } from 'hono';
import { RateLimitRule } from '../../../domain/security/RateLimit';
import { InMemoryRateLimitStore } from '../../../infrastructure/security/InMemoryRateLimitStore';
import { ApiResponse } from '@goldplus/shared';

// One shared process-wide store for all limiters.
const store = new InMemoryRateLimitStore();

function clientIp(c: Context): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown'
  );
}

/**
 * Per-IP fixed-window rate limiter. Applied to sensitive endpoints
 * (auth, OTP, webhooks) to blunt brute-force and flooding.
 */
export function rateLimit(rule: RateLimitRule, opts: { name: string } = { name: 'default' }) {
  return async (c: Context, next: Next) => {
    const key = `${opts.name}:${clientIp(c)}`;
    const decision = store.hit(key, rule);
    c.header('X-RateLimit-Limit', String(decision.limit));
    c.header('X-RateLimit-Remaining', String(decision.remaining));

    if (!decision.allowed) {
      c.header('Retry-After', String(decision.retryAfterSeconds));
      const res: ApiResponse<never> = {
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again shortly.' },
      };
      return c.json(res, 429);
    }
    await next();
  };
}
