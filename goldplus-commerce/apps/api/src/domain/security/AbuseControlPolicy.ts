/**
 * Abuse-control policy. Pure domain — no Redis, Hono, adapters.
 *
 * Two decisions live here because both are easy to get subtly wrong and both
 * need to be testable without a network.
 */

export type AttributionConfidence = 'TRUSTED' | 'UNVERIFIED' | 'UNKNOWN';

export interface ControlLimit {
  limit: number;
  windowMs: number;
}

/**
 * The limit that applies to a request, given how confidently the caller was
 * identified.
 *
 * An unattributed request is not an ordinary customer. It shares a bucket with
 * every other unattributed request, so if it were granted the normal per-client
 * budget the shared bucket would be exhausted almost immediately and every
 * unidentifiable client — including legitimate ones behind a misconfigured proxy
 * — would be locked out. That is a denial-of-service mechanism built out of a
 * rate limiter.
 *
 * So the shared bucket gets its own, larger ceiling: generous enough that
 * legitimate degraded traffic is not cut off at the normal per-client number,
 * bounded enough that it cannot be used as free capacity. It is a global
 * allowance, not a per-client one, and it is deliberately not unlimited.
 */
export function limitFor(base: ControlLimit, confidence: AttributionConfidence): ControlLimit {
  switch (confidence) {
    case 'TRUSTED':
      return base;
    case 'UNVERIFIED':
      // A real address, but the chain was not as configured. Half the budget:
      // enough to work, little enough that it is not an attractive path.
      return { limit: Math.max(1, Math.floor(base.limit / 2)), windowMs: base.windowMs };
    case 'UNKNOWN':
      // One shared global allowance for everything unattributable.
      return { limit: Math.max(base.limit, base.limit * 4), windowMs: base.windowMs };
  }
}

/**
 * Whether the fixed window should reject.
 *
 * `count` is the value AFTER this request was counted, so the comparison is
 * strictly greater than: a limit of 10 permits the tenth request and rejects
 * the eleventh.
 */
export function exceeds(count: number, limit: number): boolean {
  return count > limit;
}

/**
 * Sliding-window decision from two adjacent fixed windows.
 *
 * A plain fixed window lets a caller send `limit` requests at the very end of
 * one window and `limit` more at the start of the next — twice the intended rate
 * across the boundary. Weighting the previous window by how much of it still
 * overlaps the current instant removes that edge without storing every
 * timestamp.
 */
export function slidingCount(
  previousCount: number,
  currentCount: number,
  elapsedInWindowMs: number,
  windowMs: number,
): number {
  if (windowMs <= 0) return currentCount;
  const overlap = Math.min(1, Math.max(0, 1 - elapsedInWindowMs / windowMs));
  return currentCount + previousCount * overlap;
}

/**
 * What a control does when its authoritative store is unreachable.
 *
 * Fail-open would remove the limit exactly when the platform is least healthy,
 * which is when abuse is most damaging. Fail-closed would turn a Redis blip into
 * a total outage of login and checkout.
 *
 * So: degrade to a local in-process limiter with a stricter budget. Each replica
 * enforces its own share, so the effective global limit is (replicas × share)
 * rather than unbounded — a bounded overshoot instead of either extreme.
 */
export const DEGRADED_LIMIT_DIVISOR = 4;

export function degradedLimit(base: ControlLimit): ControlLimit {
  return {
    limit: Math.max(1, Math.floor(base.limit / DEGRADED_LIMIT_DIVISOR)),
    windowMs: base.windowMs,
  };
}

/**
 * Privacy-safe, bounded key.
 *
 * The raw identity is hashed so an address or an email address is not sitting in
 * plaintext in Redis, where it would be readable by anyone with access to the
 * cache and would outlive the request in a system that never consented to store
 * it. Truncating the digest bounds key length; the control name and endpoint are
 * kept readable so an operator can see what a key is for.
 *
 * Cardinality is bounded by construction: the identity component is a fixed-width
 * digest, so a caller cannot mint unbounded distinct keys by varying its input.
 */
export function controlKey(parts: {
  control: string;
  endpoint: string;
  identity: string;
  digest: (value: string) => string;
}): string {
  const endpoint = parts.endpoint.replace(/[^a-zA-Z0-9/_-]/g, '').slice(0, 64) || '/';
  return `abuse:${parts.control}:${endpoint}:${parts.digest(parts.identity).slice(0, 32)}`;
}
