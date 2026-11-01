import { eq } from 'drizzle-orm';
import { db } from '../db/client';
import { notificationTemplateOverrides } from '../db/schema/notificationTemplates';
import { logger } from '../logging/logger';
import {
  NotificationTemplateKey,
  TemplateWordingOverride,
  setTemplateOverrideProvider,
} from '../../application/use-cases/notifications/NotificationTemplateRenderer';

/**
 * Published-override cache (Wave 2E-3). The renderer stays synchronous and
 * database-free: this cache loads PUBLISHED rows on boot and every minute, and the
 * renderer reads through the injected provider. A cache failure logs and keeps the
 * previous map — wording degrades to the code defaults, never to an error.
 */
class TemplateOverrideCache {
  private map = new Map<string, TemplateWordingOverride>();
  private timer: NodeJS.Timeout | null = null;

  get(key: NotificationTemplateKey): TemplateWordingOverride | undefined {
    return this.map.get(key);
  }

  async refresh(): Promise<void> {
    try {
      const rows = await db
        .select()
        .from(notificationTemplateOverrides)
        .where(eq(notificationTemplateOverrides.status, 'PUBLISHED'));
      const next = new Map<string, TemplateWordingOverride>();
      for (const row of rows) {
        next.set(row.templateKey, { subject: row.subject, preheader: row.preheader, headline: row.headline });
      }
      this.map = next;
    } catch (err) {
      logger.warn({ err: (err as Error).message }, '[TemplateOverrideCache] refresh failed — keeping previous overrides');
    }
  }

  start(intervalMs = 60_000): void {
    setTemplateOverrideProvider((key) => this.get(key));
    void this.refresh();
    if (!this.timer) {
      this.timer = setInterval(() => void this.refresh(), intervalMs);
      this.timer.unref?.();
    }
  }
}

export const templateOverrideCache = new TemplateOverrideCache();
