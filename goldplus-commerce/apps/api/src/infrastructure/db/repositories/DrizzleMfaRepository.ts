import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '../client';
import { authSessionStepUps, userMfa, userMfaRecoveryCodes } from '../schema/identity';
import { IMfaRepository, MfaRecord } from '../../../application/ports/IMfaRepository';

const UUID = /^[0-9a-f-]{36}$/i;

export class DrizzleMfaRepository implements IMfaRepository {
  async recordSessionStepUp(familyId: string, userId: string, at: Date): Promise<void> {
    if (!UUID.test(familyId) || !UUID.test(userId)) return;
    await db
      .insert(authSessionStepUps)
      .values({ familyId, userId, verifiedAt: at })
      .onConflictDoUpdate({ target: authSessionStepUps.familyId, set: { verifiedAt: at }, where: eq(authSessionStepUps.userId, userId) });
    // Small by nature (admins step up), kept small: rows for this user older than a month are spent.
    await db.delete(authSessionStepUps).where(and(eq(authSessionStepUps.userId, userId), sql`${authSessionStepUps.verifiedAt} < ${new Date(at.getTime() - 30 * 86_400_000)}`));
  }

  async sessionStepUpAt(familyId: string, userId: string): Promise<Date | null> {
    if (!UUID.test(familyId) || !UUID.test(userId)) return null;
    const [row] = await db
      .select({ verifiedAt: authSessionStepUps.verifiedAt })
      .from(authSessionStepUps)
      .where(and(eq(authSessionStepUps.familyId, familyId), eq(authSessionStepUps.userId, userId)))
      .limit(1);
    return row?.verifiedAt ?? null;
  }

  async get(userId: string): Promise<MfaRecord | null> {
    const row = await db.query.userMfa.findFirst({ where: eq(userMfa.userId, userId) });
    if (!row) return null;
    return {
      userId: row.userId,
      secretCiphertext: row.secretCiphertext,
      pendingSecretCiphertext: row.pendingSecretCiphertext ?? null,
      confirmedAt: row.confirmedAt ?? null,
      lastVerifiedAt: row.lastVerifiedAt ?? null,
      failedAttempts: row.failedAttempts ?? 0,
      updatedAt: row.updatedAt,
    };
  }

  async recordFailure(userId: string, at: Date, decayAfterMs?: number): Promise<number> {
    const next =
      decayAfterMs && decayAfterMs > 0
        ? sql`case when ${userMfa.updatedAt} <= ${new Date(at.getTime() - decayAfterMs)} then 1 else ${userMfa.failedAttempts} + 1 end`
        : sql`${userMfa.failedAttempts} + 1`;
    const [row] = await db
      .update(userMfa)
      .set({ failedAttempts: next, updatedAt: at })
      .where(eq(userMfa.userId, userId))
      .returning({ failedAttempts: userMfa.failedAttempts });
    return row?.failedAttempts ?? 0;
  }

  async upsertEnrolment(userId: string, secretCiphertext: string): Promise<void> {
    await db
      .insert(userMfa)
      .values({ userId, secretCiphertext })
      .onConflictDoUpdate({
        target: userMfa.userId,
        // Re-enrolling resets confirmation and freshness: a new secret is not a
        // proven factor until its first code is verified.
        // Only an UNCONFIRMED row is replaced: a confirmed authenticator is never cleared here (MfaService parks a
        // replacement with setPendingSecret instead), even if two requests race.
        set: { secretCiphertext, pendingSecretCiphertext: null, confirmedAt: null, lastVerifiedAt: null, updatedAt: new Date() },
        where: isNull(userMfa.confirmedAt),
      });
  }

  async setPendingSecret(userId: string, secretCiphertext: string): Promise<void> {
    await db
      .update(userMfa)
      .set({ pendingSecretCiphertext: secretCiphertext })
      .where(and(eq(userMfa.userId, userId), isNotNull(userMfa.confirmedAt)));
  }

  async promotePendingSecret(userId: string, at: Date): Promise<void> {
    await db
      .update(userMfa)
      .set({
        secretCiphertext: sql`${userMfa.pendingSecretCiphertext}`,
        pendingSecretCiphertext: null,
        confirmedAt: at,
        lastVerifiedAt: at,
        failedAttempts: 0,
        updatedAt: at,
      })
      .where(and(eq(userMfa.userId, userId), isNotNull(userMfa.pendingSecretCiphertext)));
  }

  async rewrapSecret(userId: string, oldCiphertext: string, newCiphertext: string): Promise<void> {
    await db
      .update(userMfa)
      .set({ secretCiphertext: newCiphertext })
      .where(and(eq(userMfa.userId, userId), eq(userMfa.secretCiphertext, oldCiphertext)));
    await db
      .update(userMfa)
      .set({ pendingSecretCiphertext: newCiphertext })
      .where(and(eq(userMfa.userId, userId), eq(userMfa.pendingSecretCiphertext, oldCiphertext)));
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
