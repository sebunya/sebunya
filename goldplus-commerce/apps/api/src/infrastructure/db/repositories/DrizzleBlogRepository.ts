import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '../client';
import { blogPosts, blogPostProducts } from '../schema/blog';
import { products, productPrices, categories } from '../schema/products';
import { productImages } from '../schema/phase11';
import {
  IBlogRepository,
  BlogPostRecord,
  BlogRelatedProduct,
} from '../../../application/ports/IBlogRepository';
import { BlogStatus } from '../../../domain/blog/BlogPost';

type Row = typeof blogPosts.$inferSelect;

const toRecord = (row: Row): BlogPostRecord => ({
  id: row.id,
  slug: row.slug,
  title: row.title,
  excerpt: row.excerpt,
  body: row.body,
  coverImageUrl: row.coverImageUrl,
  coverImageAlt: row.coverImageAlt,
  status: row.status as BlogStatus,
  metaTitle: row.metaTitle,
  metaDescription: row.metaDescription,
  publishedAt: row.publishedAt,
  updatedAt: row.updatedAt,
  createdAt: row.createdAt,
  authorName: row.authorName,
});

/** A slug is a public URL; treat anything unslug-like as "not found", never as SQL. */
const SLUG_SHAPE = /^[a-z0-9][a-z0-9-]{0,199}$/;
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class DrizzleBlogRepository implements IBlogRepository {
  async listPublished(opts: { limit?: number; offset?: number } = {}): Promise<BlogPostRecord[]> {
    const rows = await db
      .select()
      .from(blogPosts)
      .where(eq(blogPosts.status, 'PUBLISHED'))
      // Newest first, id breaking ties so paging is a total order and cannot
      // skip or repeat an article.
      .orderBy(desc(blogPosts.publishedAt), asc(blogPosts.id))
      .limit(Math.min(opts.limit ?? 20, 100))
      .offset(Math.max(0, opts.offset ?? 0));
    return rows.map(toRecord);
  }

  async countPublished(): Promise<number> {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(blogPosts)
      .where(eq(blogPosts.status, 'PUBLISHED'));
    return Number(row?.count ?? 0);
  }

  async listAll(opts: { limit?: number; offset?: number } = {}): Promise<BlogPostRecord[]> {
    const rows = await db
      .select()
      .from(blogPosts)
      .orderBy(desc(blogPosts.updatedAt), asc(blogPosts.id))
      .limit(Math.min(opts.limit ?? 50, 200))
      .offset(Math.max(0, opts.offset ?? 0));
    return rows.map(toRecord);
  }

  async findBySlug(slug: string, opts: { includeUnpublished?: boolean } = {}): Promise<BlogPostRecord | null> {
    if (!SLUG_SHAPE.test(slug)) return null;
    const [row] = await db
      .select()
      .from(blogPosts)
      .where(
        opts.includeUnpublished
          ? eq(blogPosts.slug, slug)
          : and(eq(blogPosts.slug, slug), eq(blogPosts.status, 'PUBLISHED')),
      )
      .limit(1);
    return row ? toRecord(row) : null;
  }

  async findById(id: string): Promise<BlogPostRecord | null> {
    if (!UUID_SHAPE.test(id)) return null;
    const [row] = await db.select().from(blogPosts).where(eq(blogPosts.id, id)).limit(1);
    return row ? toRecord(row) : null;
  }

  async slugExists(slug: string, excludeId?: string): Promise<boolean> {
    const rows = await db
      .select({ id: blogPosts.id })
      .from(blogPosts)
      .where(excludeId && UUID_SHAPE.test(excludeId)
        ? and(eq(blogPosts.slug, slug), ne(blogPosts.id, excludeId))
        : eq(blogPosts.slug, slug))
      .limit(1);
    return rows.length > 0;
  }

  async create(input: Omit<BlogPostRecord, 'id' | 'createdAt' | 'updatedAt'> & { authorId: string | null }): Promise<BlogPostRecord> {
    const [row] = await db
      .insert(blogPosts)
      .values({
        slug: input.slug,
        title: input.title,
        excerpt: input.excerpt,
        body: input.body,
        coverImageUrl: input.coverImageUrl,
        coverImageAlt: input.coverImageAlt,
        status: input.status,
        metaTitle: input.metaTitle,
        metaDescription: input.metaDescription,
        publishedAt: input.publishedAt,
        authorId: input.authorId,
        authorName: input.authorName,
      })
      .returning();
    return toRecord(row);
  }

  async update(id: string, input: Partial<Omit<BlogPostRecord, 'id' | 'createdAt'>>): Promise<BlogPostRecord | null> {
    if (!UUID_SHAPE.test(id)) return null;
    const [row] = await db
      .update(blogPosts)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(blogPosts.id, id))
      .returning();
    return row ? toRecord(row) : null;
  }

  async remove(id: string): Promise<boolean> {
    if (!UUID_SHAPE.test(id)) return false;
    const rows = await db.delete(blogPosts).where(eq(blogPosts.id, id)).returning({ id: blogPosts.id });
    return rows.length > 0;
  }

  /**
   * Replace the whole set in one transaction. Deleting and re-inserting across
   * two commits would leave an article with no recommendations if the second
   * failed — visible to readers as an empty section.
   */
  async setRelatedProducts(postId: string, productIds: string[]): Promise<void> {
    if (!UUID_SHAPE.test(postId)) return;
    const clean = productIds.filter((id) => UUID_SHAPE.test(id)).slice(0, 6);
    await db.transaction(async (tx) => {
      await tx.delete(blogPostProducts).where(eq(blogPostProducts.postId, postId));
      if (clean.length > 0) {
        await tx.insert(blogPostProducts).values(
          clean.map((productId, index) => ({ postId, productId, position: index })),
        ).onConflictDoNothing();
      }
    });
  }

  async relatedProductIds(postId: string): Promise<string[]> {
    if (!UUID_SHAPE.test(postId)) return [];
    const rows = await db
      .select({ productId: blogPostProducts.productId })
      .from(blogPostProducts)
      .where(eq(blogPostProducts.postId, postId))
      .orderBy(asc(blogPostProducts.position));
    return rows.map((r) => r.productId);
  }

  /**
   * Only approved, active products are ever recommended. An article that links
   * to a withdrawn product sends a reader to a dead end, and it is the article
   * that gets blamed for it.
   */
  async relatedProducts(postId: string): Promise<BlogRelatedProduct[]> {
    if (!UUID_SHAPE.test(postId)) return [];
    const rows = await db
      .select({
        id: products.id,
        slug: products.slug,
        name: products.name,
        categoryName: products.categoryName,
        categoryId: products.categoryId,
        position: blogPostProducts.position,
      })
      .from(blogPostProducts)
      .innerJoin(products, eq(products.id, blogPostProducts.productId))
      .where(
        and(
          eq(blogPostProducts.postId, postId),
          eq(products.approvalStatus, 'approved'),
          eq(products.active, true),
        ),
      )
      .orderBy(asc(blogPostProducts.position));
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const [priceRows, imageRows, categoryRows] = await Promise.all([
      db.select().from(productPrices).where(inArray(productPrices.productId, ids)),
      db.select().from(productImages).where(inArray(productImages.productId, ids)),
      db.select({ id: categories.id, name: categories.name }).from(categories),
    ]);
    const priceById = new Map(priceRows.map((p) => [p.productId, Number(p.retailPrice ?? 0) || null]));
    const floorById = new Map(priceRows.map((p) => [p.productId, p.floorPrice ?? null]));
    const categoryById = new Map(categoryRows.map((c) => [c.id, c.name]));
    const imageByProduct = new Map<string, string>();
    for (const image of [...imageRows].sort(
      (a, b) => Number(b.isPrimary) - Number(a.isPrimary) || (a.displayOrder ?? 0) - (b.displayOrder ?? 0),
    )) {
      if (!imageByProduct.has(image.productId)) imageByProduct.set(image.productId, image.url);
    }

    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      categoryName: categoryById.get(r.categoryId) ?? r.categoryName ?? null,
      retailPriceUgx: priceById.get(r.id) ?? null,
      floorPriceUgx: floorById.get(r.id) ?? null,
      primaryImageUrl: imageByProduct.get(r.id) ?? null,
    }));
  }
}
