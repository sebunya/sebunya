import { Context, Next } from 'hono';
import { logger } from '../../../infrastructure/logging/logger';

interface RateLimitInfo {
  count: number;
  resetTime: number;
}

const rateLimitStore = new Map<string, RateLimitInfo>();

// Periodically prune expired entries to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, info] of rateLimitStore.entries()) {
    if (now > info.resetTime) {
      rateLimitStore.delete(key);
    }
  }
}, 60000).unref();

export function rateLimiter(options: { limit: number; windowMs: number }) {
  return async (c: Context, next: Next) => {
    if (process.env.NODE_ENV === 'test') {
      return next();
    }

    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'ip-unknown';
    const key = `${ip}:${c.req.path}`;
    const now = Date.now();

    let info = rateLimitStore.get(key);
    if (!info || now > info.resetTime) {
      info = {
        count: 0,
        resetTime: now + options.windowMs,
      };
    }

    info.count++;
    rateLimitStore.set(key, info);

    c.header('X-RateLimit-Limit', String(options.limit));
    c.header('X-RateLimit-Remaining', String(Math.max(0, options.limit - info.count)));
    c.header('X-RateLimit-Reset', String(Math.ceil(info.resetTime / 1000)));

    if (info.count > options.limit) {
      logger.warn({ ip, path: c.req.path }, '[RateLimit] Rate limit exceeded');
      return c.json({
        success: false,
        error: {
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many requests, please try again later.',
        }
      }, 429);
    }

    await next();
  };
}
