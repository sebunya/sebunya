/**
 * Fixed-window rate limiting — pure decision logic.
 *
 * The store (in-memory, Redis, …) lives in infra; this only decides,
 * given the current count in a window, whether a request is allowed and
 * what the caller should report (remaining, retry-after).
 */

export interface RateLimitRule {
  /** Max requests permitted per window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  limit: number;
  retryAfterSeconds: number;
}

/**
 * @param currentCount number of requests already made in this window
 *                     (the caller increments the store, then asks us).
 * @param windowStartedAtMs when the current window began.
 */
export function evaluateRateLimit(
  rule: RateLimitRule,
  currentCount: number,
  windowStartedAtMs: number,
  nowMs: number = Date.now()
): RateLimitDecision {
  const windowMs = rule.windowSeconds * 1000;
  const elapsed = nowMs - windowStartedAtMs;
  const resetInMs = Math.max(windowMs - elapsed, 0);
  const allowed = currentCount <= rule.limit;
  return {
    allowed,
    remaining: Math.max(rule.limit - currentCount, 0),
    limit: rule.limit,
    retryAfterSeconds: allowed ? 0 : Math.ceil(resetInMs / 1000) || rule.windowSeconds,
  };
}
