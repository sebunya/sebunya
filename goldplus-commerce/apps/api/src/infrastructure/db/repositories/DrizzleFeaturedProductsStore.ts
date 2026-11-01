import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { FeaturedProductsStore } from '../../../application/ports/SpotifyRotation';

const rowsOf = (r: unknown): any[] => (Array.isArray(r) ? r : ((r as { rows?: any[] })?.rows ?? []));
const tableExists = async () =>
  Boolean(rowsOf(await db.execute(sql`select to_regclass('public.ad_featured_products') is not null as ok`))[0]?.ok);

/** ad_featured_products (0170). Before the migration: none featured, and saving refuses. */
export class DrizzleFeaturedProductsStore implements FeaturedProductsStore {
  async list(platform: string): Promise<string[]> {
    if (!(await tableExists())) return [];
    return rowsOf(await db.execute(sql`select product_id from ad_featured_products where platform = ${platform} order by added_at`)).map((r) => String(r.product_id));
  }

  async replace(platform: string, productIds: string[], actorId: string | null): Promise<void> {
    if (!(await tableExists())) throw new Error('ad_featured_products does not exist: migration 0170 is not applied');
    await db.transaction(async (tx) => {
      await tx.execute(sql`delete from ad_featured_products where platform = ${platform}`);
      for (const id of productIds) {
        await tx.execute(sql`insert into ad_featured_products (platform, product_id, added_by) values (${platform}, ${id}::uuid, ${actorId}::uuid)`);
      }
    });
  }
}
