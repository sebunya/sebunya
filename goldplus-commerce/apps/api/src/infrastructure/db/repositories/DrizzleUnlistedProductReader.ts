import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { IUnlistedProductReader, UnlistedProductNotice } from '../../../application/ports/IUnlistedProductReader';

const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? (r as never) : ((r as { rows?: never[] })?.rows ?? []));

/**
 * "Was it ever on the storefront?" is answered by the product market-event
 * history (0169): a row with published = true exists for every product that
 * was approved and active at any point since the history began.
 */
export class DrizzleUnlistedProductReader implements IUnlistedProductReader {
  async findUnlistedBySlug(slug: string): Promise<UnlistedProductNotice | null> {
    const [row] = rowsOf(await db.execute(sql`
      SELECT p.name, c.slug AS category_slug, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.slug = ${slug}
        AND NOT (p.approval_status = 'approved' AND p.active = true)
        AND EXISTS (SELECT 1 FROM product_market_events e WHERE e.product_id = p.id AND e.published = true)
      LIMIT 1`));
    if (!row) return null;
    return { name: String(row.name), categorySlug: row.category_slug == null ? null : String(row.category_slug), categoryName: row.category_name == null ? null : String(row.category_name) };
  }
}
