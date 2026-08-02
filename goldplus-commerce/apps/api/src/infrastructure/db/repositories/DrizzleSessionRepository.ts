import { and, desc, eq, isNull, lte, gt } from 'drizzle-orm';
import { db } from '../client';
import { authSessions } from '../schema/identity';
import {
  ISessionRepository,
  NewSession,
  SessionForDecision,
  SessionInventoryItem,
} from '../../../application/ports/ISessionRepository';
import { RevocationReason } from '../../../domain/identity/SessionPolicy';

export class DrizzleSessionRepository implements ISessionRepository {
  async create(session: NewSession): Promise<void> {
    await db.insert(authSessions).values({
      userId: session.userId,
      familyId: session.familyId,
      refreshHash: session.refreshHash,
      jti: session.jti,
      keyVersion: session.keyVersion,
      permissionVersion: session.permissionVersion,
      accessExpiresAt: session.accessExpiresAt,
      refreshExpiresAt: session.refreshExpiresAt,
      userAgentHash: session.userAgentHash ?? null,
      ipHash: session.ipHash ?? null,
    });
  }

  async findByRefreshHash(refreshHash: string): Promise<SessionForDecision | null> {
    const row = await db.query.authSessions.findFirst({
      where: eq(authSessions.refreshHash, refreshHash),
    });
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      familyId: row.familyId,
      rotatedAt: row.rotatedAt ?? null,
      revokedAt: row.revokedAt ?? null,
      refreshExpiresAt: row.refreshExpiresAt,
    };
  }

  /**
   * Consume `currentHash` and mint `next` in one transaction. The consume is a
   * CONDITIONAL update — it only sets rotated_at on a row that is still
   * rotatable — so if two requests present the same credential at once, exactly
   * one update matches a row and the other gets zero and returns false. That is
   * what makes rotation single-use under concurrency; the caller treats false as
   * reuse and revokes the family.
   */
  async rotate(currentHash: string, next: NewSession): Promise<boolean> {
    return db.transaction(async (tx) => {
      const consumed = await tx
        .update(authSessions)
        .set({ rotatedAt: new Date(), lastUsedAt: new Date() })
        .where(
          and(
            eq(authSessions.refreshHash, currentHash),
            isNull(authSessions.rotatedAt),
            isNull(authSessions.revokedAt),
            gt(authSessions.refreshExpiresAt, new Date()),
          ),
        )
        .returning({ id: authSessions.id });

      if (consumed.length === 0) return false;

      await tx.insert(authSessions).values({
        userId: next.userId,
        familyId: next.familyId,
        refreshHash: next.refreshHash,
        jti: next.jti,
        keyVersion: next.keyVersion,
        permissionVersion: next.permissionVersion,
        accessExpiresAt: next.accessExpiresAt,
        refreshExpiresAt: next.refreshExpiresAt,
        userAgentHash: next.userAgentHash ?? null,
        ipHash: next.ipHash ?? null,
      });
      return true;
    });
  }

  async revokeFamily(familyId: string, reason: RevocationReason, now: Date): Promise<number> {
    const rows = await db
      .update(authSessions)
      .set({ revokedAt: now, revokedReason: reason })
      .where(and(eq(authSessions.familyId, familyId), isNull(authSessions.revokedAt)))
      .returning({ id: authSessions.id });
    return rows.length;
  }

  async revokeAllForUser(userId: string, reason: RevocationReason, now: Date): Promise<number> {
    const rows = await db
      .update(authSessions)
      .set({ revokedAt: now, revokedReason: reason })
      .where(and(eq(authSessions.userId, userId), isNull(authSessions.revokedAt)))
      .returning({ id: authSessions.id });
    return rows.length;
  }

  async listActiveForUser(userId: string, now: Date): Promise<SessionInventoryItem[]> {
    // One entry per family: the current (non-rotated, non-revoked, unexpired)
    // credential is the live head of each active session.
    const rows = await db
      .select({
        familyId: authSessions.familyId,
        createdAt: authSessions.createdAt,
        lastUsedAt: authSessions.lastUsedAt,
        refreshExpiresAt: authSessions.refreshExpiresAt,
      })
      .from(authSessions)
      .where(
        and(
          eq(authSessions.userId, userId),
          isNull(authSessions.revokedAt),
          isNull(authSessions.rotatedAt),
          gt(authSessions.refreshExpiresAt, now),
        ),
      )
      .orderBy(desc(authSessions.lastUsedAt));
    return rows;
  }

  async cleanupExpired(now: Date): Promise<number> {
    const rows = await db
      .delete(authSessions)
      .where(lte(authSessions.refreshExpiresAt, now))
      .returning({ id: authSessions.id });
    return rows.length;
  }
}
