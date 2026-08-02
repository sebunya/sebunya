import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ISessionRepository } from '../../application/ports/ISessionRepository';
import {
  decideRefresh,
  sessionExpiries,
  RevocationReason,
} from '../../domain/identity/SessionPolicy';

export interface IssuedSession {
  userId: string;
  refreshToken: string;
  familyId: string;
  jti: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
}

export type RotateResult =
  | { ok: true; session: IssuedSession }
  | { ok: false; reason: 'INVALID' | 'EXPIRED' | 'REVOKED' | 'REUSE_DETECTED' };

/**
 * Durable session lifecycle. Composes the pure policy, the repository and the
 * crypto here — the domain stays free of Node crypto, and the routes stay free
 * of rotation rules.
 *
 * The refresh token is opaque random bytes. Only its SHA-256 hash is ever
 * stored, so a database read (or a leaked backup) yields nothing usable. There
 * is no pepper on the hash on purpose: the token is 256 bits of entropy, not a
 * low-entropy secret, so a plain digest is not brute-forceable and a peppered
 * one would only add a rotation liability.
 */
export class SessionService {
  constructor(private readonly repo: ISessionRepository) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private newRefreshToken(): string {
    // URL-safe, no padding — carried in a cookie/header by the BFF.
    return randomBytes(32).toString('base64url');
  }

  async issue(input: {
    userId: string;
    permissionVersion?: number;
    keyVersion?: number;
    userAgentHash?: string | null;
    ipHash?: string | null;
    now?: Date;
  }): Promise<IssuedSession> {
    const now = input.now ?? new Date();
    const { accessExpiresAt, refreshExpiresAt } = sessionExpiries(now);
    const refreshToken = this.newRefreshToken();
    const familyId = randomUUID();
    const jti = randomUUID();
    await this.repo.create({
      userId: input.userId,
      familyId,
      refreshHash: this.hash(refreshToken),
      jti,
      keyVersion: input.keyVersion ?? 1,
      permissionVersion: input.permissionVersion ?? 0,
      accessExpiresAt,
      refreshExpiresAt,
      userAgentHash: input.userAgentHash ?? null,
      ipHash: input.ipHash ?? null,
    });
    return { userId: input.userId, refreshToken, familyId, jti, accessExpiresAt, refreshExpiresAt };
  }

  async rotate(input: {
    refreshToken: string;
    permissionVersion?: number;
    keyVersion?: number;
    userAgentHash?: string | null;
    ipHash?: string | null;
    now?: Date;
  }): Promise<RotateResult> {
    const now = input.now ?? new Date();
    const currentHash = this.hash(input.refreshToken);
    const row = await this.repo.findByRefreshHash(currentHash);
    const decision = decideRefresh(row, now);

    if (decision.action === 'REVOKED') return { ok: false, reason: 'REVOKED' };
    if (decision.action === 'EXPIRED') return { ok: false, reason: 'EXPIRED' };
    if (decision.action === 'REUSE_DETECTED') {
      // A consumed (or unknown-but-plausible) credential was replayed. Kill the
      // whole family if we can identify it — either the client or an attacker
      // holds a copy and we cannot keep the session alive for the wrong one.
      if (row) await this.repo.revokeFamily(row.familyId, 'refresh_reuse_detected', now);
      return { ok: false, reason: 'REUSE_DETECTED' };
    }

    // ROTATE. Mint the next credential in the same family; the repository's
    // conditional consume makes this single-use even under a concurrent replay.
    const { accessExpiresAt, refreshExpiresAt } = sessionExpiries(now);
    const refreshToken = this.newRefreshToken();
    const jti = randomUUID();
    const rotated = await this.repo.rotate(currentHash, {
      userId: row!.userId,
      familyId: row!.familyId,
      refreshHash: this.hash(refreshToken),
      jti,
      keyVersion: input.keyVersion ?? 1,
      permissionVersion: input.permissionVersion ?? 0,
      accessExpiresAt,
      refreshExpiresAt,
      userAgentHash: input.userAgentHash ?? null,
      ipHash: input.ipHash ?? null,
    });

    if (!rotated) {
      // Lost the race: another request already consumed this exact credential.
      // That is a concurrent reuse — revoke the family.
      await this.repo.revokeFamily(row!.familyId, 'refresh_reuse_detected', now);
      return { ok: false, reason: 'REUSE_DETECTED' };
    }

    return {
      ok: true,
      session: {
        userId: row!.userId,
        refreshToken,
        familyId: row!.familyId,
        jti,
        accessExpiresAt,
        refreshExpiresAt,
      },
    };
  }

  /** Revoke the single session a refresh token belongs to (logout current). */
  async logout(refreshToken: string, now = new Date()): Promise<void> {
    const row = await this.repo.findByRefreshHash(this.hash(refreshToken));
    if (row) await this.repo.revokeFamily(row.familyId, 'logout', now);
  }

  /** Revoke every session for a user (logout everywhere / disable). */
  async logoutAll(
    userId: string,
    reason: RevocationReason = 'logout_all',
    now = new Date(),
  ): Promise<number> {
    return this.repo.revokeAllForUser(userId, reason, now);
  }
}
