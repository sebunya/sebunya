import { eq, and, isNull } from 'drizzle-orm';
import { db } from '../client';
import { firstPartyIdentities } from '../schema/telemetry';

export type IdentityRecord = typeof firstPartyIdentities.$inferSelect;
export type IdentityUpsert = {
  fpClientId?: string;
  userId?: string;
  gclid?: string;
  wbraid?: string;
  gbraid?: string;
  fbc?: string;
  fbp?: string;
  ttclid?: string;
  twclid?: string;
  li_fat_id?: string;
  epik?: string;
  hashedEmail?: string;
  hashedPhone?: string;
  ipAddress?: string;
  userAgent?: string;
};

/**
 * PHASE 4 — IDENTITY GRAPH REPOSITORY
 */
export class DrizzleIdentityRepository {
  async upsertByFpClientId(fpClientId: string, data: IdentityUpsert): Promise<IdentityRecord> {
    const existing = await db
      .select()
      .from(firstPartyIdentities)
      .where(eq(firstPartyIdentities.fpClientId, fpClientId))
      .limit(1);

    if (existing.length === 0) {
      const [inserted] = await db
        .insert(firstPartyIdentities)
        .values({ fpClientId, ...this.clean(data), updatedAt: new Date() })
        .returning();
      return inserted;
    }

    const row = existing[0];
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(this.clean(data))) {
      if (v && !row[k as keyof IdentityRecord]) {
        patch[k] = v;
      }
    }

    const [updated] = await db
      .update(firstPartyIdentities)
      .set(patch)
      .where(eq(firstPartyIdentities.fpClientId, fpClientId))
      .returning();
    return updated;
  }

  async stitchToUser(fpClientId: string, userId: string): Promise<void> {
    await db
      .update(firstPartyIdentities)
      .set({ userId, updatedAt: new Date() })
      .where(
        and(
          eq(firstPartyIdentities.fpClientId, fpClientId),
          isNull(firstPartyIdentities.userId)
        )
      );
  }

  async getByUserId(userId: string): Promise<IdentityRecord | null> {
    const rows = await db
      .select()
      .from(firstPartyIdentities)
      .where(eq(firstPartyIdentities.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  }

  async getByFpClientId(fpClientId: string): Promise<IdentityRecord | null> {
    const rows = await db
      .select()
      .from(firstPartyIdentities)
      .where(eq(firstPartyIdentities.fpClientId, fpClientId))
      .limit(1);
    return rows[0] ?? null;
  }

  private clean(data: IdentityUpsert): Partial<IdentityUpsert> {
    return Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== undefined && v !== null && v !== '')
    ) as Partial<IdentityUpsert>;
  }
}
