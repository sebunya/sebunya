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

/** Columns holding an ad click or browser id: replaced by a newer one, and timed by click_ids_at. */
export const CLICK_ID_COLUMNS = ['gclid', 'wbraid', 'gbraid', 'fbc', 'fbp', 'ttclid', 'twclid', 'li_fat_id', 'epik'] as const;
/** The subset that names an AD CLICK (everything but Meta's browser id): one click at a time, the latest. */
export const AD_CLICK_COLUMNS = ['gclid', 'wbraid', 'gbraid', 'fbc', 'ttclid', 'twclid', 'li_fat_id', 'epik'] as const;

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

    const now = new Date();
    const incoming = this.clean(data);
    const carriesClick = CLICK_ID_COLUMNS.some((k) => !!incoming[k]);
    if (existing.length === 0) {
      const [inserted] = await db
        .insert(firstPartyIdentities)
        .values({ fpClientId, ...incoming, updatedAt: now, ...(carriesClick ? { clickIdsAt: now } : {}) })
        .returning();
      return inserted;
    }

    const row = existing[0];
    const patch: Record<string, unknown> = { updatedAt: now };
    let clickChanged = false;
    for (const [k, v] of Object.entries(incoming)) {
      if (!v) continue;
      // Click ids: the LAST click wins, as it does in the browser's own record
      // (lib/attribution). They used to be first-write-wins like everything
      // else here, so a returning visitor's new ad click was never stored and
      // the first one was reported to the ad platform for ever (2026-10-01).
      if ((CLICK_ID_COLUMNS as readonly string[]).includes(k)) {
        if (row[k as keyof IdentityRecord] !== v) { patch[k] = v; clickChanged = true; }
      } else if (!row[k as keyof IdentityRecord]) {
        patch[k] = v;
      }
    }
    // …and it replaces the previous click ENTIRELY, as the browser's record
    // does: the stitch carries the browser's current ad click, so a network
    // it no longer names is cleared. Otherwise an old Meta click would ride
    // along with a newer Google one and both networks would be told about
    // the same visitor's events. (A browser id is not a click: it stays.)
    if (AD_CLICK_COLUMNS.some((k) => !!incoming[k])) {
      for (const k of AD_CLICK_COLUMNS) {
        if (!incoming[k] && row[k as keyof IdentityRecord]) { patch[k] = null; clickChanged = true; }
      }
    }
    if (clickChanged) patch.clickIdsAt = now;

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
