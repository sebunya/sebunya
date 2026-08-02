import { RevocationReason } from '../../domain/identity/SessionPolicy';

/** A refresh credential to persist. The token itself is passed pre-hashed. */
export interface NewSession {
  userId: string;
  familyId: string;
  refreshHash: string;
  jti: string;
  keyVersion: number;
  permissionVersion: number;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  userAgentHash?: string | null;
  ipHash?: string | null;
}

/** A stored credential row as returned to the application. */
export interface StoredSession {
  id: string;
  userId: string;
  familyId: string;
  jti: string;
  keyVersion: number;
  permissionVersion: number;
  createdAt: Date;
  lastUsedAt: Date;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  revokedReason: string | null;
}

/** A row for the reuse/rotation decision (subset the policy needs). */
export interface SessionForDecision {
  id: string;
  userId: string;
  familyId: string;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  refreshExpiresAt: Date;
}

/** One active session in the user-facing inventory (a family). */
export interface SessionInventoryItem {
  familyId: string;
  createdAt: Date;
  lastUsedAt: Date;
  refreshExpiresAt: Date;
}

/**
 * Durable, revocable session store. The source of truth is PostgreSQL so
 * revocation is correct with Redis entirely down. Rotation and reuse detection
 * must be ATOMIC — a concurrent double-submit of the same credential must not
 * both succeed.
 */
export interface ISessionRepository {
  /** Persist a brand-new session (new family). */
  create(session: NewSession): Promise<void>;

  /** Look up a credential by its refresh hash for the rotation decision. */
  findByRefreshHash(refreshHash: string): Promise<SessionForDecision | null>;

  /**
   * Atomically consume `currentHash` and mint `next` in the same family. Returns
   * false if the current row was not in a rotatable state at commit time (lost a
   * race), so the caller can treat it as reuse rather than issue a second token.
   */
  rotate(currentHash: string, next: NewSession): Promise<boolean>;

  /** Revoke every non-revoked credential in a family. Returns rows affected. */
  revokeFamily(familyId: string, reason: RevocationReason, now: Date): Promise<number>;

  /** Revoke every non-revoked credential for a user (logout-all / disable). */
  revokeAllForUser(userId: string, reason: RevocationReason, now: Date): Promise<number>;

  /** Active families for a user, most-recently-used first. */
  listActiveForUser(userId: string, now: Date): Promise<SessionInventoryItem[]>;

  /** Delete credentials whose refresh window has passed. Returns rows removed. */
  cleanupExpired(now: Date): Promise<number>;
}
