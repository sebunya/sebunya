import { and, eq, asc } from 'drizzle-orm';
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
      orderBy: [asc(productImages.displayOrder), asc(productImages.createdAt)],
    });
    return rows.map(rowToDto);
  }

  async add(input: {
    productId: string;
    url: string;
    altText: string | null;
    makePrimary: boolean;
  }): Promise<PersistedProductImage> {
    return db.transaction(async (tx) => {
      const existing = await tx.query.productImages.findMany({ where: eq(productImages.productId, input.productId) });
      const shouldBePrimary = input.makePrimary || existing.length === 0;

      if (shouldBePrimary && existing.some((i) => i.isPrimary)) {
        await tx.update(productImages).set({ isPrimary: false }).where(eq(productImages.productId, input.productId));
      }

      const [row] = await tx
        .insert(productImages)
        .values({
          productId: input.productId,
          url: input.url,
          altText: input.altText,
          displayOrder: existing.length,
          isPrimary: shouldBePrimary,
        })
        .returning();
      return rowToDto(row);
    });
  }

  async remove(imageId: string): Promise<{ removedProductId: string } | null> {
    const row = await db.query.productImages.findFirst({ where: eq(productImages.id, imageId) });
    if (!row) return null;
    await db.delete(productImages).where(eq(productImages.id, imageId));
    // If the removed row was primary, promote the lowest-display-order survivor.
    if (row.isPrimary) {
      const survivors = await db.query.productImages.findMany({
        where: eq(productImages.productId, row.productId),
        orderBy: [asc(productImages.displayOrder)],
        limit: 1,
      });
      if (survivors[0]) {
        await db.update(productImages).set({ isPrimary: true }).where(eq(productImages.id, survivors[0].id));
      }
    }
    return { removedProductId: row.productId };
  }

  async setPrimary(productId: string, imageId: string): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.update(productImages).set({ isPrimary: false }).where(eq(productImages.productId, productId));
      await tx
        .update(productImages)
        .set({ isPrimary: true })
        .where(and(eq(productImages.productId, productId), eq(productImages.id, imageId)));
    });
  }
}
