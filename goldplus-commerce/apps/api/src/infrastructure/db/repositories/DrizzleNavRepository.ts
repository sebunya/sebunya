import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { INavRepository, StoredNavConfig } from '../../../application/ports/INavRepository';
import type { NavConfig } from '@goldplus/shared';
import { pgJsonb } from '../PgParams';

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);

const toStored = (row: any): StoredNavConfig => ({
  // postgres-js already hands back parsed jsonb as an object; defensively unwrap a
  // legacy double-encoded string if one ever slipped in.
  config: (typeof row.config === 'string' ? JSON.parse(row.config) : row.config) as NavConfig,
  version: Number(row.version ?? 1),
  updatedAt: new Date(row.updated_at ?? Date.now()),
});

export class DrizzleNavRepository implements INavRepository {
  async getConfig(): Promise<StoredNavConfig | null> {
    const rows = rowsOf(await db.execute(sql`select config, version, updated_at from nav_config where id = true limit 1`));
    return rows[0] ? toStored(rows[0]) : null;
  }

  async updateConfig(config: NavConfig, actorId: string, expectedVersion?: number): Promise<StoredNavConfig | null> {
    // jsonb: bind the RAW object and cast ::jsonb — the double-encoding fix.
    // NEVER JSON.stringify first (postgres-js serializes the bound object once).
    // Optimistic concurrency: when expectedVersion is given, the WHERE also pins
    // the version, so a stale-based save matches 0 rows and returns null.
    const guard = expectedVersion != null ? sql`and version = ${expectedVersion}` : sql``;
    const rows = rowsOf(
      await db.execute(sql`
        update nav_config
           set config = ${pgJsonb(config)},
               version = version + 1,
               updated_by = ${actorId}::uuid,
               updated_at = now()
         where id = true ${guard}
         returning config, version, updated_at
      `),
    );
    return rows[0] ? toStored(rows[0]) : null;
  }

  async seedMissing(defaultConfig: NavConfig): Promise<{ inserted: number }> {
    // Add-only; a redeploy never overwrites an operator's edit.
    const rows = rowsOf(
      await db.execute(sql`
        insert into nav_config (id, config, version)
        values (true, ${pgJsonb(defaultConfig)}, 1)
        on conflict (id) do nothing
        returning id
      `),
    );
    return { inserted: rows.length };
  }
}
