import { and, eq, asc, isNull, sql } from 'drizzle-orm';
import { db } from '../client';
import { productImages } from '../schema/phase11';
import { products } from '../schema/products';
import { IProductImageRepository, PersistedProductImage } from '../../../application/ports/IProductImageRepository';

function rowToDto(row: typeof productImages.$inferSelect): PersistedProductImage {
  return {
    id: row.id,
    productId: row.productId,
    url: row.url,
    altText: row.altText ?? null,
    displayOrder: row.displayOrder,
    isPrimary: row.isPrimary,
  };
}

export class DrizzleProductImageRepository implements IProductImageRepository {
  async findByProductId(productId: string): Promise<PersistedProductImage[]> {
    const rows = await db.query.productImages.findMany({
      where: eq(productImages.productId, productId),
      // Focus 4: canonical slot first, legacy projection after — the same precedence as the resolver.
      orderBy: [sql`${productImages.slot} ASC NULLS LAST`, asc(productImages.displayOrder), asc(productImages.createdAt)],
    });
    return rows.map(rowToDto);
  }

  async findProductIdForImage(imageId: string): Promise<string | null> {
    const row = await db.query.productImages.findFirst({ where: eq(productImages.id, imageId), columns: { productId: true } });
    return row?.productId ?? null;
  }

  /**
   * Focus 4: refused. A gallery row is written only by ProductMediaUseCases
   * (slot map, revision, projection, usages and audit in one transaction).
   * Kept on the port so old callers fail loudly instead of silently bypassing.
   */
  async add(): Promise<PersistedProductImage> {
    throw new Error('SUPERSEDED: product_images is written only through ProductMediaUseCases (Focus 4).');
  }

  /**
   * Legacy rows only. A row that holds a gallery slot must leave through the
   * mutation service (a cover needs a replacement; nothing is promoted here).
   */
  async remove(imageId: string): Promise<{ removedProductId: string } | null> {
    const row = await db.query.productImages.findFirst({ where: eq(productImages.id, imageId) });
    if (!row) return null;
    if (row.slot !== null) throw new Error('SUPERSEDED: a slotted gallery image is removed through ProductMediaUseCases (Focus 4).');
    await db.transaction(async (tx) => {
      const gone = await tx.delete(productImages).where(and(eq(productImages.id, imageId), isNull(productImages.slot))).returning({ id: productImages.id });
      if (gone.length === 0 || !row.isPrimary) return;
      // The removed row was the cover: promote the first surviving legacy image and move the product's
      // image_url/has_image projection with it (cleared when none is left), so cards stop showing a deleted image.
      const [survivor] = await tx
        .select({ id: productImages.id, url: productImages.url })
        .from(productImages)
        .where(and(eq(productImages.productId, row.productId), isNull(productImages.slot)))
        .orderBy(asc(productImages.displayOrder), asc(productImages.createdAt))
        .limit(1);
      if (survivor) await tx.update(productImages).set({ isPrimary: true }).where(eq(productImages.id, survivor.id));
      await tx
        .update(products)
        .set({ imageUrl: survivor?.url ?? null, hasImage: !!survivor, updatedAt: new Date() })
        .where(and(eq(products.id, row.productId), sql`${products.imageUrl} is not distinct from ${row.url}`));
    });
    return { removedProductId: row.productId };
  }

  /** Focus 4: refused — use ProductMediaUseCases.mutate({ type: 'SET_COVER' }). */
  async setPrimary(): Promise<void> {
    throw new Error('SUPERSEDED: the cover is slot 1, set through ProductMediaUseCases (Focus 4).');
  }
}
