import { RateLimitRule, evaluateRateLimit, RateLimitDecision } from '../../domain/security/RateLimit';

interface Bucket {
  count: number;
  windowStartedAtMs: number;
}

/**
 * Fixed-window rate-limit store kept in process memory. Good enough for a
 * single-instance modular monolith and for blunting brute force; swap for
 * a Redis-backed store when scaling horizontally (same domain decision).
 */
export class InMemoryRateLimitStore {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = Date.now();

  hit(key: string, rule: RateLimitRule, nowMs: number = Date.now()): RateLimitDecision {
    this.maybeSweep(nowMs);
    const windowMs = rule.windowSeconds * 1000;
    let bucket = this.buckets.get(key);
    if (!bucket || nowMs - bucket.windowStartedAtMs >= windowMs) {
      bucket = { count: 0, windowStartedAtMs: nowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    return evaluateRateLimit(rule, bucket.count, bucket.windowStartedAtMs, nowMs);
  }

  /** Evict expired buckets occasionally so the map can't grow unbounded. */
  private maybeSweep(nowMs: number): void {
    if (nowMs - this.lastSweep < 60_000) return;
    this.lastSweep = nowMs;
    for (const [key, bucket] of this.buckets) {
      if (nowMs - bucket.windowStartedAtMs > 3_600_000) this.buckets.delete(key);
    }
  }
}
