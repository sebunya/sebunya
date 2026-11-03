import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { IBusinessInfoRepository, StoredBusinessInfo } from '../../../application/ports/IBusinessInfoRepository';
import type { BusinessInfo } from '@goldplus/shared';
import { pgJsonb } from '../PgParams';

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);

const toStored = (row: any): StoredBusinessInfo => ({
  config: (typeof row.config === 'string' ? JSON.parse(row.config) : row.config) as BusinessInfo,
  version: Number(row.version ?? 1),
  updatedAt: new Date(row.updated_at ?? Date.now()),
});

export class DrizzleBusinessInfoRepository implements IBusinessInfoRepository {
  async getConfig(): Promise<StoredBusinessInfo | null> {
    const rows = rowsOf(await db.execute(sql`select config, version, updated_at from business_info where id = true limit 1`));
    return rows[0] ? toStored(rows[0]) : null;
  }

  async updateConfig(config: BusinessInfo, actorId: string): Promise<StoredBusinessInfo> {
    // jsonb: bind the RAW object and cast ::jsonb (never JSON.stringify first).
    // Upsert: the boot seed is best-effort, and a plain UPDATE of a missing row returned nothing (a 500 on save).
    const rows = rowsOf(
      await db.execute(sql`
        insert into business_info (id, config, version, updated_by, updated_at)
        values (true, ${pgJsonb(config)}, 1, ${actorId}::uuid, now())
        on conflict (id) do update
           set config = excluded.config,
               version = business_info.version + 1,
               updated_by = excluded.updated_by,
               updated_at = now()
         returning config, version, updated_at
      `),
    );
    return toStored(rows[0]);
  }

  async seedMissing(defaultConfig: BusinessInfo): Promise<{ inserted: number }> {
    const rows = rowsOf(
      await db.execute(sql`
        insert into business_info (id, config, version)
        values (true, ${pgJsonb(defaultConfig)}, 1)
        on conflict (id) do nothing
        returning id
      `),
    );
    return { inserted: rows.length };
  }
}
