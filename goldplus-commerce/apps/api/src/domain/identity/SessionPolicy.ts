/**
 * Session policy. Pure domain — no Redis, Postgres, Hono or crypto adapters.
 *
 * The refresh-rotation state machine and the reuse decision live here because
 * both are easy to get subtly wrong and must be testable without a database.
 * Token bytes and hashing are the infrastructure's job; the RULES are here.
 */

export const SESSION_LIFETIMES = {
  /** Short — a stolen access token is useful for minutes, not days. */
  accessTtlMs: 15 * 60_000,
  /** Long, but rotated on every use so a leaked one is single-use. */
  refreshTtlMs: 30 * 24 * 60 * 60_000,
} as const;

/** A stored refresh-credential row, as the policy needs to see it. */
export interface SessionRow {
  id: string;
  userId: string;
  familyId: string;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  refreshExpiresAt: Date;
}

export type RefreshOutcome =
  | { action: 'ROTATE' }
  | { action: 'REVOKED' }
  | { action: 'EXPIRED' }
  | { action: 'REUSE_DETECTED' };

/**
 * Decide what presenting this refresh credential means.
 *
 * Order matters. Revoked and expired are terminal and take precedence over
 * reuse so we return the most accurate reason. The reuse rule is the important
 * one: a credential whose row is already consumed (rotatedAt set) was replayed.
 * We cannot tell a legitimate double-submit from an attacker's stolen copy, so
 * the only safe answer is to end the whole family — the price of a false
 * positive is one re-login; the price of a false negative is a live stolen
 * session.
 */
export function decideRefresh(row: SessionRow | null, now: Date): RefreshOutcome {
  if (!row) return { action: 'REUSE_DETECTED' }; // unknown hash: never issued, or already pruned after a prior rotation
  if (row.revokedAt) return { action: 'REVOKED' };
  if (row.refreshExpiresAt.getTime() <= now.getTime()) return { action: 'EXPIRED' };
  if (row.rotatedAt) return { action: 'REUSE_DETECTED' };
  return { action: 'ROTATE' };
}

/** Access/refresh expiry instants for a credential minted at `now`. */
export function sessionExpiries(now: Date): { accessExpiresAt: Date; refreshExpiresAt: Date } {
  return {
    accessExpiresAt: new Date(now.getTime() + SESSION_LIFETIMES.accessTtlMs),
    refreshExpiresAt: new Date(now.getTime() + SESSION_LIFETIMES.refreshTtlMs),
  };
}

/**
 * Whether an access token issued at `issuedAt` is killed by an immediate
 * hard-revocation cutoff (password change, disable, admin logout-everywhere).
 * A token issued at or before the cutoff is dead regardless of its signature
 * validity — this is what makes revocation not wait for the access TTL.
 */
export function isInvalidatedByCutoff(issuedAt: Date, cutoff: Date | null | undefined): boolean {
  if (!cutoff) return false;
  return issuedAt.getTime() <= cutoff.getTime();
}

export type RevocationReason =
  | 'logout'
  | 'logout_all'
  | 'admin_revoke'
  | 'password_change'
  | 'permission_change'
  | 'account_disabled'
  | 'refresh_reuse_detected';
