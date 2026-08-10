import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { ITaxonomyRepository, StoredTaxonomy } from '../../../application/ports/ITaxonomyRepository';
import type { Taxonomy } from '@goldplus/shared';

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);

const toStored = (row: any): StoredTaxonomy => ({
  config: (typeof row.config === 'string' ? JSON.parse(row.config) : row.config) as Taxonomy,
  version: Number(row.version ?? 1),
  updatedAt: new Date(row.updated_at ?? Date.now()),
});

/**
 * The config is a JSON ARRAY. postgres-js would serialize a raw JS array as a
 * Postgres array literal, so (unlike the object singletons) we bind the JSON
 * text — cast ::text FIRST so the driver types the parameter as plain text
 * (a bare ::jsonb made it JSON-encode the string again, storing a quoted
 * scalar; the tolerant reader masked it), then ::jsonb parses it once.
 */
export class DrizzleTaxonomyRepository implements ITaxonomyRepository {
  async getConfig(): Promise<StoredTaxonomy | null> {
    const rows = rowsOf(await db.execute(sql`select config, version, updated_at from taxonomy_config where id = true limit 1`));
    return rows[0] ? toStored(rows[0]) : null;
  }

  async updateConfig(config: Taxonomy, actorId: string): Promise<StoredTaxonomy> {
    const rows = rowsOf(
      await db.execute(sql`
        update taxonomy_config
           set config = ${JSON.stringify(config)}::text::jsonb,
               version = version + 1,
               updated_by = ${actorId}::uuid,
               updated_at = now()
         where id = true
         returning config, version, updated_at
      `),
    );
    return toStored(rows[0]);
  }

  async seedMissing(defaultConfig: Taxonomy): Promise<{ inserted: number }> {
    const rows = rowsOf(
      await db.execute(sql`
        insert into taxonomy_config (id, config, version)
        values (true, ${JSON.stringify(defaultConfig)}::text::jsonb, 1)
        on conflict (id) do nothing
        returning id
      `),
    );
    return { inserted: rows.length };
  }
}
