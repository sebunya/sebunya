import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../client';
import { userMfa, userMfaRecoveryCodes } from '../schema/identity';
import { IMfaRepository, MfaRecord } from '../../../application/ports/IMfaRepository';

export class DrizzleMfaRepository implements IMfaRepository {
  async get(userId: string): Promise<MfaRecord | null> {
    const row = await db.query.userMfa.findFirst({ where: eq(userMfa.userId, userId) });
    if (!row) return null;
    return {
      userId: row.userId,
      secretCiphertext: row.secretCiphertext,
      confirmedAt: row.confirmedAt ?? null,
      lastVerifiedAt: row.lastVerifiedAt ?? null,
    };
  }

  async upsertEnrolment(userId: string, secretCiphertext: string): Promise<void> {
    await db
      .insert(userMfa)
      .values({ userId, secretCiphertext })
      .onConflictDoUpdate({
        target: userMfa.userId,
        // Re-enrolling resets confirmation and freshness: a new secret is not a
        // proven factor until its first code is verified.
        set: { secretCiphertext, confirmedAt: null, lastVerifiedAt: null, updatedAt: new Date() },
      });
  }

  async confirm(userId: string, at: Date): Promise<void> {
    await db
      .update(userMfa)
      .set({ confirmedAt: at, lastVerifiedAt: at, failedAttempts: 0, updatedAt: at })
      .where(eq(userMfa.userId, userId));
  }

  async recordVerification(userId: string, at: Date): Promise<void> {
    await db
      .update(userMfa)
      .set({ lastVerifiedAt: at, failedAttempts: 0, updatedAt: at })
      .where(eq(userMfa.userId, userId));
  }

  async replaceRecoveryCodes(userId: string, codeHashes: string[]): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(userMfaRecoveryCodes).where(eq(userMfaRecoveryCodes.userId, userId));
      if (codeHashes.length) {
        await tx
          .insert(userMfaRecoveryCodes)
          .values(codeHashes.map((codeHash) => ({ userId, codeHash })));
      }
    });
  }

  async consumeRecoveryCode(userId: string, codeHash: string, at: Date): Promise<boolean> {
    // Conditional update: only an unused code owned by this user is consumed,
    // and only once even under concurrent submits.
    const rows = await db
      .update(userMfaRecoveryCodes)
      .set({ usedAt: at })
      .where(
        and(
          eq(userMfaRecoveryCodes.userId, userId),
          eq(userMfaRecoveryCodes.codeHash, codeHash),
          isNull(userMfaRecoveryCodes.usedAt),
        ),
      )
      .returning({ id: userMfaRecoveryCodes.id });
    return rows.length > 0;
  }

  async disable(userId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(userMfaRecoveryCodes).where(eq(userMfaRecoveryCodes.userId, userId));
      await tx.delete(userMfa).where(eq(userMfa.userId, userId));
    });
  }
}
