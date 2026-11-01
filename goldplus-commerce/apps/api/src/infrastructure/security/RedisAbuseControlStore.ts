import Redis from 'ioredis';
import { createHash } from 'node:crypto';
import { logger } from '../logging/logger';
import {
  ControlLimit,
  controlKey,
  degradedLimit,
  exceeds,
  slidingCount,
} from '../../domain/security/AbuseControlPolicy';

/**
 * Distributed abuse control.
 *
 * The in-memory limiter this replaces was not a production control. It reset on
 * every deploy or crash, it was inconsistent between replicas, and — the part
 * that made the configured numbers meaningless — each replica enforced the limit
 * independently, so the effective limit was the configured one multiplied by the
 * number of API instances. A "5 failed logins" lockout across four replicas was
 * twenty attempts, and nothing in the configuration said so.
 *
 * Redis holds the authoritative counters. Memory survives only as a labelled
 * emergency fallback with a deliberately stricter budget.
 */

export interface ControlDecision {
  allowed: boolean;
  count: number;
  limit: number;
  resetAtMs: number;
  /** True when Redis was unreachable and the local fallback decided. */
  degraded: boolean;
}

/**
 * Two adjacent fixed windows, incremented and expired in ONE round trip.
 *
 * Atomicity matters: INCR followed by a separate EXPIRE can lose the expiry if
 * the process dies between them, leaving a counter that never resets and a
 * client locked out permanently. A script makes the pair indivisible.
 *
 * The previous window is read in the same script so the sliding weight is
 * computed from a consistent snapshot rather than two racing reads.
 */
const SLIDING_INCR = `
local currentKey = KEYS[1]
local previousKey = KEYS[2]
local ttl = tonumber(ARGV[1])
local current = redis.call('INCR', currentKey)
if current == 1 then
  redis.call('PEXPIRE', currentKey, ttl * 2)
end
local previous = tonumber(redis.call('GET', previousKey) or '0')
return { current, previous }
`;

export class RedisAbuseControlStore {
  private client: Redis | null = null;
  private unavailableUntil = 0;
  private readonly fallback = new Map<string, { count: number; resetAtMs: number }>();
  private scriptSha: string | null = null;

  constructor(private readonly redisUrl: string | undefined = process.env.REDIS_URL) {
    const timer = setInterval(() => this.pruneFallback(), 60_000);
    timer.unref?.();
  }

  private connect(): Redis | null {
    if (this.client) return this.client;
    if (!this.redisUrl) return null;
    try {
      this.client = new Redis(this.redisUrl, {
        // A control that blocks the request path must never wait long. If Redis
        // is slow the degraded policy is a better answer than a stalled login.
        connectTimeout: 1_000,
        commandTimeout: 250,
        maxRetriesPerRequest: 1,
        // Commands issued while the connection is still being established must
        // WAIT for it, not be rejected. With the offline queue disabled, every
        // request in that window was treated as a Redis outage and silently
        // decided by the local fallback — which is the first burst after every
        // deploy or restart, exactly when a flood is most likely. commandTimeout
        // still bounds the wait, so a genuinely dead Redis degrades promptly
        // rather than hanging the request.
        enableOfflineQueue: true,
        lazyConnect: false,
      });
      this.client.on('error', (err) => {
        logger.warn({ err: err.message }, 'ABUSE_CONTROL_REDIS_ERROR');
      });
      return this.client;
    } catch (err) {
      logger.error({ err: String(err) }, 'ABUSE_CONTROL_REDIS_CONNECT_FAILED');
      return null;
    }
  }

  /** Stable, privacy-safe key component. */
  private digest(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  async consume(args: {
    control: string;
    endpoint: string;
    identity: string;
    limit: ControlLimit;
    now?: number;
    /**
     * What the local fallback does when Redis is unreachable. STRICT (default)
     * divides the budget — right for human forms and reads, where a bounded
     * per-replica overshoot is the correct trade. GENEROUS keeps the full budget
     * locally — right for HMAC-authenticated, low-volume, high-value provider
     * webhooks, where dropping a real payment confirmation during a Redis blip is
     * worse than allowing the configured rate on each replica.
     */
    outagePolicy?: 'STRICT' | 'GENEROUS';
  }): Promise<ControlDecision> {
    const now = args.now ?? Date.now();
    const { windowMs } = args.limit;
    const windowIndex = Math.floor(now / windowMs);
    const elapsed = now - windowIndex * windowMs;
    const resetAtMs = (windowIndex + 1) * windowMs;
    const outagePolicy = args.outagePolicy ?? 'STRICT';

    const base = controlKey({
      control: args.control,
      endpoint: args.endpoint,
      identity: args.identity,
      digest: (v) => this.digest(v),
    });

    if (now < this.unavailableUntil) {
      return this.decideLocally(base, args.limit, now, resetAtMs, windowMs, outagePolicy);
    }

    const client = this.connect();
    if (!client) return this.decideLocally(base, args.limit, now, resetAtMs, windowMs, outagePolicy);

    try {
      const raw = (await client.eval(
        SLIDING_INCR,
        2,
        `${base}:${windowIndex}`,
        `${base}:${windowIndex - 1}`,
        String(windowMs),
      )) as [number, number];

      const weighted = slidingCount(Number(raw[1]), Number(raw[0]), elapsed, windowMs);
      return {
        allowed: !exceeds(weighted, args.limit.limit),
        count: Math.ceil(weighted),
        limit: args.limit.limit,
        resetAtMs,
        degraded: false,
      };
    } catch (err) {
      // Back off from Redis briefly rather than paying the timeout on every
      // request while it is down.
      this.unavailableUntil = now + 5_000;
      logger.warn({ err: String(err), control: args.control }, 'ABUSE_CONTROL_DEGRADED');
      return this.decideLocally(base, args.limit, now, resetAtMs, windowMs, outagePolicy);
    }
  }

  /**
   * Emergency fallback. Explicitly NOT the production control: it is per-replica
   * and therefore multiplies with instance count. STRICT families run on a
   * divided budget to bound the overshoot; GENEROUS families (provider webhooks)
   * keep the full budget so a Redis blip cannot drop a legitimate callback.
   */
  private decideLocally(
    base: string,
    limit: ControlLimit,
    now: number,
    resetAtMs: number,
    windowMs: number,
    outagePolicy: 'STRICT' | 'GENEROUS' = 'STRICT',
  ): ControlDecision {
    const effective = outagePolicy === 'GENEROUS' ? limit : degradedLimit(limit);
    const entry = this.fallback.get(base);
    if (!entry || now >= entry.resetAtMs) {
      this.fallback.set(base, { count: 1, resetAtMs: now + windowMs });
      return { allowed: true, count: 1, limit: effective.limit, resetAtMs, degraded: true };
    }
    entry.count += 1;
    return {
      allowed: !exceeds(entry.count, effective.limit),
      count: entry.count,
      limit: effective.limit,
      resetAtMs: entry.resetAtMs,
      degraded: true,
    };
  }

  private pruneFallback(): void {
    const now = Date.now();
    for (const [key, entry] of this.fallback.entries()) {
      if (now >= entry.resetAtMs) this.fallback.delete(key);
    }
  }

  /** Health signal for the readiness endpoint. */
  async probe(): Promise<{ available: boolean; degraded: boolean }> {
    const client = this.connect();
    if (!client) return { available: false, degraded: true };
    try {
      await client.ping();
      return { available: true, degraded: Date.now() < this.unavailableUntil };
    } catch {
      return { available: false, degraded: true };
    }
  }

  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.quit();
      } catch {
        this.client.disconnect();
      }
      this.client = null;
    }
  }
}

/** Process-wide instance; the counters are in Redis, not here. */
export const abuseControlStore = new RedisAbuseControlStore();
