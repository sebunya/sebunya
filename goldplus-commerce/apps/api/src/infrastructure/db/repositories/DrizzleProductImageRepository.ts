import { and, eq, asc, isNull, sql } from 'drizzle-orm';
import { db } from '../client';
import { productImages } from '../schema/phase11';
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
    await db.delete(productImages).where(and(eq(productImages.id, imageId), isNull(productImages.slot)));
    return { removedProductId: row.productId };
  }

  /** Focus 4: refused — use ProductMediaUseCases.mutate({ type: 'SET_COVER' }). */
  async setPrimary(): Promise<void> {
    throw new Error('SUPERSEDED: the cover is slot 1, set through ProductMediaUseCases (Focus 4).');
  }
}
