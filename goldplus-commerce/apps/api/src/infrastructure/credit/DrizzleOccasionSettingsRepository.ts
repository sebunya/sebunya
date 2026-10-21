import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import type { IOccasionSettingsRepository } from '../../application/use-cases/credit/GiftCardOccasionUseCases';
import type { OccasionSettings } from '../../domain/credit/GiftCardOccasions';

const rowsOf = (r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] })?.rows ?? [])) as Array<Record<string, any>>;

/** 0200: one row. Read as text and parsed, so a value stored as a jsonb string (the drizzle gotcha) reads the same. */
export class DrizzleOccasionSettingsRepository implements IOccasionSettingsRepository {
  async read(): Promise<unknown> {
    const [r] = rowsOf(await db.execute(sql`select settings #>> '{}' as s, jsonb_typeof(settings) as t, settings::text as raw from gift_card_occasion_settings where id = 1`));
    if (!r) return {};
    try { return JSON.parse(r.t === 'string' ? r.s : r.raw); } catch { return {}; }
  }
  async write(settings: OccasionSettings, actorId: string): Promise<void> {
    await db.execute(sql`
      insert into gift_card_occasion_settings (id, settings, updated_by, updated_at) values (1, ${JSON.stringify(settings)}::text::jsonb, ${actorId}, now())
      on conflict (id) do update set settings = excluded.settings, updated_by = excluded.updated_by, updated_at = now()`);
  }
}
