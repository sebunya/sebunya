import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '../client';
import { redirects, gscPerformance } from '../schema/seo';
import { products } from '../schema/products';

export interface SitemapProduct { slug: string; updatedAt: Date; }

/**
 * U6 — SEO repository: automatic redirects on slug change (AC6), sitemap product
 * enumeration with real lastmod (AC1/AC2), and the GSC warehouse query (AC7).
 */
export class DrizzleSeoRepository {
  /** AC6 — a slug change creates a 301 from the old product URL to the new one.
   * Idempotent: repeating updates the target. Any redirect whose from_path now
   * equals the new path (a rename back) is removed to avoid a self-loop. */
  async recordSlugChange(input: { oldSlug: string; newSlug: string; createdBy: string | null; now: Date }): Promise<{ fromPath: string; toPath: string }> {
    const fromPath = `/p/${input.oldSlug}`;
    const toPath = `/p/${input.newSlug}`;
    await db.delete(redirects).where(eq(redirects.fromPath, toPath)); // clear any loop for the new path
    await db
      .insert(redirects)
      .values({ fromPath, toPath, statusCode: 301, reason: 'product_slug_change', createdBy: input.createdBy })
      .onConflictDoUpdate({ target: redirects.fromPath, set: { toPath, statusCode: 301, reason: 'product_slug_change' } });
    return { fromPath, toPath };
  }

  /** AC6 — resolve a path to its redirect target, recording the hit. */
  async resolveRedirect(fromPath: string, now: Date): Promise<{ toPath: string; statusCode: number } | null> {
    const [row] = await db.select().from(redirects).where(eq(redirects.fromPath, fromPath)).limit(1);
    if (!row) return null;
    await db.update(redirects).set({ hitCount: sql`${redirects.hitCount} + 1`, lastHitAt: now }).where(eq(redirects.id, row.id));
    return { toPath: row.toPath, statusCode: row.statusCode };
  }

  /** AC1/AC2 — every APPROVED, ACTIVE product for the sitemap, with real lastmod
   * (updated_at), paginated. Not capped at the product-listing default of 60. */
  async sitemapProducts(offset: number, limit: number): Promise<SitemapProduct[]> {
    const rows = await db
      .select({ slug: products.slug, updatedAt: products.updatedAt })
      .from(products)
      .where(and(eq(products.active, true), eq(products.approvalStatus, 'approved')))
      .orderBy(products.slug)
      .limit(Math.min(limit, 50_000))
      .offset(offset);
    return rows;
  }

  async listRedirects(limit = 100): Promise<Array<{ id: string; fromPath: string; toPath: string; statusCode: number; hitCount: number; reason: string | null }>> {
    return db.select({ id: redirects.id, fromPath: redirects.fromPath, toPath: redirects.toPath, statusCode: redirects.statusCode, hitCount: redirects.hitCount, reason: redirects.reason }).from(redirects).orderBy(desc(redirects.createdAt)).limit(Math.min(limit, 500));
  }

  async countSitemapProducts(): Promise<number> {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(products).where(and(eq(products.active, true), eq(products.approvalStatus, 'approved')));
    return row?.n ?? 0;
  }

  /** AC7 — clicks by product for the last 28 days from the GSC warehouse. */
  async clicksByProductLast28Days(asOf: Date): Promise<Array<{ productId: string; clicks: number }>> {
    const since = new Date(asOf.getTime() - 28 * 86_400_000).toISOString().slice(0, 10);
    const rows = await db
      .select({ productId: gscPerformance.productId, clicks: sql<number>`sum(${gscPerformance.clicks})::int` })
      .from(gscPerformance)
      .where(and(gte(gscPerformance.date, since), sql`${gscPerformance.productId} IS NOT NULL`))
      .groupBy(gscPerformance.productId);
    return rows.map((r) => ({ productId: r.productId as string, clicks: r.clicks }));
  }
}
