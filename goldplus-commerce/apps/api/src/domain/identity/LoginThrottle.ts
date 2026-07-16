/**
 * Login lockout policy (Slice 1B). Pure domain — no Hono, Drizzle, adapters.
 *
 * Deterministic account-level throttle: 5 failed attempts within a 15-minute
 * window lock the (email, ip) pair for 15 minutes. Successful login clears the
 * pair. This complements — never replaces — the global IP rate limiter.
 */

export const LOGIN_LOCK_POLICY = {
  maxFailures: 5,
  windowMinutes: 15,
  lockMinutes: 15,
} as const;

const MINUTE_MS = 60 * 1000;

/** Canonical throttle key: lowercased email + ip, never logged with the password. */
export function loginThrottleKey(email: string, ip: string): string {
  return `${email.trim().toLowerCase()}|${ip.trim() || 'ip-unknown'}`;
}

export interface LoginLockState {
  locked: boolean;
  failuresInWindow: number;
  retryAfterSeconds: number;
}

/** Failures older than the window are ignored; the newest failure anchors the lock. */
export function evaluateLoginLock(failureTimes: Date[], now: Date): LoginLockState {
  const windowStart = now.getTime() - LOGIN_LOCK_POLICY.windowMinutes * MINUTE_MS;
  const inWindow = failureTimes.filter((t) => t.getTime() >= windowStart);
  if (inWindow.length < LOGIN_LOCK_POLICY.maxFailures) {
    return { locked: false, failuresInWindow: inWindow.length, retryAfterSeconds: 0 };
  }
  const newest = Math.max(...inWindow.map((t) => t.getTime()));
  const unlockAt = newest + LOGIN_LOCK_POLICY.lockMinutes * MINUTE_MS;
  const remainingMs = unlockAt - now.getTime();
  if (remainingMs <= 0) {
    return { locked: false, failuresInWindow: inWindow.length, retryAfterSeconds: 0 };
  }
  return { locked: true, failuresInWindow: inWindow.length, retryAfterSeconds: Math.ceil(remainingMs / 1000) };
}
