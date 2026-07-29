import { Context, Next } from 'hono';
import { logger } from '../../../infrastructure/logging/logger';
import { clientAddress, clientBucketKey } from '../clientAddress';
import { abuseControlStore } from '../../../infrastructure/security/RedisAbuseControlStore';
import { limitFor } from '../../../domain/security/AbuseControlPolicy';

/**
 * Per-client request limiting.
 *
 * Counters live in Redis, not in this process. The Map this replaced reset on
 * every deploy and was enforced independently by each replica, so the configured
 * number was silently multiplied by the instance count — a limit of 100 across
 * four replicas was 400, and nothing said so.
 *
 * The bucket key carries the attribution confidence, so an unverifiable claim
 * cannot consume or reset a real client's budget, and unresolvable clients share
 * one bounded namespace under a separate ceiling rather than being handed the
 * ordinary per-client allowance — which they would exhaust immediately, locking
 * out every other unidentifiable client.
 */
export function rateLimiter(options: { limit: number; windowMs: number }) {
  return async (c: Context, next: Next) => {
    if (process.env.NODE_ENV === 'test') {
      return next();
    }

    const address = clientAddress(c);
    const decision = await abuseControlStore.consume({
      control: 'http',
      endpoint: c.req.path,
      identity: clientBucketKey(address),
      limit: limitFor(options, address.confidence),
    });

    c.header('X-RateLimit-Limit', String(decision.limit));
    c.header('X-RateLimit-Remaining', String(Math.max(0, decision.limit - decision.count)));
    c.header('X-RateLimit-Reset', String(Math.ceil(decision.resetAtMs / 1000)));

    if (!decision.allowed) {
      logger.warn(
        {
          // The bucket key, not the raw address: this line goes to logs retained
          // far longer than the request itself.
          bucket: clientBucketKey(address),
          confidence: address.confidence,
          path: c.req.path,
          degraded: decision.degraded,
        },
        '[RateLimit] Rate limit exceeded',
      );
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
