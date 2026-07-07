import { eq } from 'drizzle-orm';
import { db } from '../client';
import { userTwoFactor } from '../schema/security';
import { ITwoFactorRepository, TwoFactorConfig, BackupCodeEntry } from '../../../application/ports/ITwoFactorRepository';

function rowToConfig(row: typeof userTwoFactor.$inferSelect): TwoFactorConfig {
  return {
    userId: row.userId,
    method: row.method as TwoFactorConfig['method'],
    totpSecret: row.totpSecret ?? null,
    enabled: row.enabled,
    backupCodes: (row.backupCodes ?? []) as BackupCodeEntry[],
    confirmedAt: row.confirmedAt ?? null,
  };
}

export class DrizzleTwoFactorRepository implements ITwoFactorRepository {
  async find(userId: string): Promise<TwoFactorConfig | null> {
    const row = await db.query.userTwoFactor.findFirst({ where: eq(userTwoFactor.userId, userId) });
    return row ? rowToConfig(row) : null;
  }

  async upsertPendingTotp(userId: string, totpSecret: string): Promise<void> {
    await db
      .insert(userTwoFactor)
      .values({ userId, method: 'totp', totpSecret, enabled: false })
      .onConflictDoUpdate({
        target: userTwoFactor.userId,
        set: { method: 'totp', totpSecret, enabled: false, updatedAt: new Date() },
      });
  }

  async enable(userId: string, method: 'totp' | 'sms' | 'email', backupCodes: BackupCodeEntry[]): Promise<void> {
    await db
      .insert(userTwoFactor)
      .values({ userId, method, enabled: true, backupCodes, confirmedAt: new Date() })
      .onConflictDoUpdate({
        target: userTwoFactor.userId,
        set: { method, enabled: true, backupCodes, confirmedAt: new Date(), updatedAt: new Date() },
      });
  }

  async disable(userId: string): Promise<void> {
    await db
      .update(userTwoFactor)
      .set({ method: 'none', enabled: false, totpSecret: null, backupCodes: [], confirmedAt: null, updatedAt: new Date() })
      .where(eq(userTwoFactor.userId, userId));
  }

  async saveBackupCodes(userId: string, backupCodes: BackupCodeEntry[]): Promise<void> {
    await db
      .update(userTwoFactor)
      .set({ backupCodes, updatedAt: new Date() })
      .where(eq(userTwoFactor.userId, userId));
  }
}
