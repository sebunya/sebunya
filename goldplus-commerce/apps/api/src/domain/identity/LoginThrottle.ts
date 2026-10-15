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

/**
 * Per ACCOUNT, across every IP (owner, 2026-10-15). The (email, ip) lock alone let one account be guessed from many
 * addresses without limit. A plain account lock would let anyone lock the owner out, so a place the account has
 * signed in from successfully in the last KNOWN_PLACE_DAYS is never held by it: the attacker is paused, the owner
 * at their usual place is not.
 */
export const ACCOUNT_LOCK_POLICY = {
  maxFailures: 20,
  windowMinutes: 15,
  lockMinutes: 15,
} as const;
export const KNOWN_PLACE_DAYS = 30;

export type LoginLockPolicy = { maxFailures: number; windowMinutes: number; lockMinutes: number };

/** The account-wide counter: every failed password for this email, whatever the IP. */
export function accountThrottleKey(email: string): string {
  return `account|${email.trim().toLowerCase()}`;
}

/** A place (IP) this account signed in from successfully. */
export function knownPlaceKey(email: string, ip: string): string {
  return `known|${email.trim().toLowerCase()}|${ip.trim() || 'ip-unknown'}`;
}

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
export function evaluateLoginLock(failureTimes: Date[], now: Date, policy: LoginLockPolicy = LOGIN_LOCK_POLICY): LoginLockState {
  const windowStart = now.getTime() - policy.windowMinutes * MINUTE_MS;
  const inWindow = failureTimes.filter((t) => t.getTime() >= windowStart);
  if (inWindow.length < policy.maxFailures) {
    return { locked: false, failuresInWindow: inWindow.length, retryAfterSeconds: 0 };
  }
  const newest = Math.max(...inWindow.map((t) => t.getTime()));
  const unlockAt = newest + policy.lockMinutes * MINUTE_MS;
  const remainingMs = unlockAt - now.getTime();
  if (remainingMs <= 0) {
    return { locked: false, failuresInWindow: inWindow.length, retryAfterSeconds: 0 };
  }
  return { locked: true, failuresInWindow: inWindow.length, retryAfterSeconds: Math.ceil(remainingMs / 1000) };
}
