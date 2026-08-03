import { and, eq } from 'drizzle-orm';
import { db } from '../client';
import { notificationTemplateOverrides } from '../schema/notificationTemplates';

/**
 * Persistence for notification wording overrides (Wave 2E-3). One DRAFT and one
 * PUBLISHED row per template key; publishing swaps them in one transaction so
 * senders never observe a half-updated template.
 */
export type TemplateOverrideRow = typeof notificationTemplateOverrides.$inferSelect;

export interface TemplateFieldPatch {
  subject: string | null;
  preheader: string | null;
  headline: string | null;
}

export class DrizzleNotificationTemplateRepository {
  async listAll(): Promise<TemplateOverrideRow[]> {
    return db.select().from(notificationTemplateOverrides);
  }

  async upsertDraft(templateKey: string, patch: TemplateFieldPatch, actorId: string): Promise<TemplateOverrideRow> {
    const [existing] = await db
      .select()
      .from(notificationTemplateOverrides)
      .where(and(eq(notificationTemplateOverrides.templateKey, templateKey), eq(notificationTemplateOverrides.status, 'DRAFT')))
      .limit(1);
    if (existing) {
      const [row] = await db
        .update(notificationTemplateOverrides)
        .set({ ...patch, updatedBy: actorId, updatedAt: new Date(), version: existing.version + 1 })
        .where(eq(notificationTemplateOverrides.id, existing.id))
        .returning();
      return row;
    }
    const [row] = await db
      .insert(notificationTemplateOverrides)
      .values({ templateKey, ...patch, updatedBy: actorId })
      .returning();
    return row;
  }

  /** Promotes the draft, replacing any previous published row atomically. */
  async publishDraft(templateKey: string, actorId: string): Promise<TemplateOverrideRow | null> {
    return db.transaction(async (tx) => {
      const [draft] = await tx
        .select()
        .from(notificationTemplateOverrides)
        .where(and(eq(notificationTemplateOverrides.templateKey, templateKey), eq(notificationTemplateOverrides.status, 'DRAFT')))
        .limit(1);
      if (!draft) return null;
      await tx
        .delete(notificationTemplateOverrides)
        .where(and(eq(notificationTemplateOverrides.templateKey, templateKey), eq(notificationTemplateOverrides.status, 'PUBLISHED')));
      const [row] = await tx
        .update(notificationTemplateOverrides)
        .set({ status: 'PUBLISHED', updatedBy: actorId, updatedAt: new Date() })
        .where(eq(notificationTemplateOverrides.id, draft.id))
        .returning();
      return row;
    });
  }

  /** Removes the published override — code defaults apply again. */
  async revertPublished(templateKey: string): Promise<string | null> {
    const deleted = await db
      .delete(notificationTemplateOverrides)
      .where(and(eq(notificationTemplateOverrides.templateKey, templateKey), eq(notificationTemplateOverrides.status, 'PUBLISHED')))
      .returning({ id: notificationTemplateOverrides.id });
    return deleted[0]?.id ?? null;
  }
}
