import { Context, Next } from 'hono';
import { logger } from '../../../infrastructure/logging/logger';
import { clientAddress, clientBucketKey } from '../clientAddress';
import { abuseControlStore } from '../../../infrastructure/security/RedisAbuseControlStore';
import { limitFor } from '../../../domain/security/AbuseControlPolicy';
import {
  classifyPublicEndpoint,
  publicEndpointPolicy,
} from '../../../domain/security/PublicEndpointPolicy';

/**
 * One authoritative, Redis-backed abuse-control layer for every public endpoint
 * family.
 *
 * This replaces the stack of per-path `rateLimiter` mounts. Each request is
 * classified into exactly one route family from a closed set, and the Redis
 * counter is keyed on that FAMILY — never the raw path — so attacker path
 * variation (extra segments, case, query, path parameters) cannot mint fresh
 * budgets. The previous `global` limiter keyed on `c.req.path`, which meant a
 * caller got the full "global" allowance for every distinct URL it invented.
 *
 * The confidence-scaled budget, the shared unattributed ceiling and the degraded
 * local fallback all come from the existing, already-proven policy and store; the
 * only thing added here is the stable family key, an endpoint-specific outage
 * policy, and a correct Retry-After.
 */
export function publicAbuseControl() {
  return async (c: Context, next: Next) => {
    // The store's own tests exercise Redis directly; skipping here keeps the
    // 4,900-test unit suite hermetic and network-free, matching the prior
    // rateLimiter. Distributed correctness is proven by the real-Redis
    // integration suite, not by unit tests.
    if (process.env.NODE_ENV === 'test') {
      return next();
    }

    const family = classifyPublicEndpoint(c.req.method, c.req.path);
    const policy = publicEndpointPolicy(family);
    const address = clientAddress(c);

    const decision = await abuseControlStore.consume({
      control: 'http',
      endpoint: family, // stable, bounded — never the raw path
      identity: clientBucketKey(address),
      limit: limitFor({ limit: policy.limit, windowMs: policy.windowMs }, address.confidence),
      outagePolicy: policy.outage,
    });

    c.header('X-RateLimit-Limit', String(decision.limit));
    c.header('X-RateLimit-Remaining', String(Math.max(0, decision.limit - decision.count)));
    c.header('X-RateLimit-Reset', String(Math.ceil(decision.resetAtMs / 1000)));

    if (!decision.allowed) {
      // Seconds until the window rolls over, floored at 1 so a client is never
      // told to retry in zero seconds.
      const retryAfter = Math.max(1, Math.ceil((decision.resetAtMs - Date.now()) / 1000));
      c.header('Retry-After', String(retryAfter));
      logger.warn(
        {
          // Bucket and family only — both bounded, neither PII. This line is
          // retained far longer than the request.
          bucket: clientBucketKey(address),
          confidence: address.confidence,
          family,
          degraded: decision.degraded,
        },
        '[AbuseControl] Public endpoint limit exceeded',
      );
      return c.json(
        {
          success: false,
          error: {
            code: 'TOO_MANY_REQUESTS',
            message: 'Too many requests, please try again later.',
          },
        },
        429,
      );
    }

    await next();
  };
}
