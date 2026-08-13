import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { IHomepageContentRepository, StoredHomepageContent } from '../../../application/ports/IHomepageContentRepository';
import type { HomepageContent } from '@goldplus/shared';
import { pgJsonb } from '../PgParams';

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);

const toStored = (row: any): StoredHomepageContent => ({
  config: (typeof row.config === 'string' ? JSON.parse(row.config) : row.config) as HomepageContent,
  version: Number(row.version ?? 1),
  updatedAt: new Date(row.updated_at ?? Date.now()),
});

export class DrizzleHomepageContentRepository implements IHomepageContentRepository {
  async getConfig(): Promise<StoredHomepageContent | null> {
    const rows = rowsOf(await db.execute(sql`select config, version, updated_at from homepage_content where id = true limit 1`));
    return rows[0] ? toStored(rows[0]) : null;
  }

  async updateConfig(config: HomepageContent, actorId: string): Promise<StoredHomepageContent> {
    // jsonb: bind the RAW object and cast ::jsonb (never JSON.stringify first).
    const rows = rowsOf(
      await db.execute(sql`
        update homepage_content
           set config = ${pgJsonb(config)},
               version = version + 1,
               updated_by = ${actorId}::uuid,
               updated_at = now()
         where id = true
         returning config, version, updated_at
      `),
    );
    return toStored(rows[0]);
  }

  async seedMissing(defaultConfig: HomepageContent): Promise<{ inserted: number }> {
    const rows = rowsOf(
      await db.execute(sql`
        insert into homepage_content (id, config, version)
        values (true, ${pgJsonb(defaultConfig)}, 1)
        on conflict (id) do nothing
        returning id
      `),
    );
    return { inserted: rows.length };
  }
}
