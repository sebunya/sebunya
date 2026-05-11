import { and, asc, eq } from 'drizzle-orm';
import { db } from '../client';
import { attributes, productAttributeValues } from '../schema/phase11';
import { IAttributeRepository, PersistedAttribute, PersistedAttributeValue } from '../../../application/ports/IAttributeRepository';

function rowToAttr(row: typeof attributes.$inferSelect): PersistedAttribute {
  return {
    id: row.id,
    categoryId: row.categoryId,
    slug: row.slug,
    name: row.name,
    unit: row.unit ?? null,
    isRequired: row.isRequired,
    displayOrder: row.displayOrder,
  };
}

function rowToValue(row: typeof productAttributeValues.$inferSelect): PersistedAttributeValue {
  return {
    productId: row.productId,
    attributeId: row.attributeId,
    value: row.value,
    isVerified: row.isVerified,
  };
}

export class DrizzleAttributeRepository implements IAttributeRepository {
  async findByCategoryId(categoryId: string): Promise<PersistedAttribute[]> {
    const rows = await db.query.attributes.findMany({
      where: eq(attributes.categoryId, categoryId),
      orderBy: [asc(attributes.displayOrder), asc(attributes.name)],
    });
    return rows.map(rowToAttr);
  }

  async findById(id: string): Promise<PersistedAttribute | null> {
    const row = await db.query.attributes.findFirst({ where: eq(attributes.id, id) });
    return row ? rowToAttr(row) : null;
  }

  async findBySlugInCategory(categoryId: string, slug: string): Promise<PersistedAttribute | null> {
    const row = await db.query.attributes.findFirst({
      where: and(eq(attributes.categoryId, categoryId), eq(attributes.slug, slug)),
    });
    return row ? rowToAttr(row) : null;
  }

  async define(input: {
    categoryId: string;
    slug: string;
    name: string;
    unit: string | null;
    isRequired: boolean;
    displayOrder: number;
  }): Promise<PersistedAttribute> {
    const [row] = await db
      .insert(attributes)
      .values({
        categoryId: input.categoryId,
        slug: input.slug,
        name: input.name,
        unit: input.unit,
        isRequired: input.isRequired,
        displayOrder: input.displayOrder,
      })
      .returning();
    return rowToAttr(row);
  }

  async findValuesByProductId(productId: string): Promise<PersistedAttributeValue[]> {
    const rows = await db.query.productAttributeValues.findMany({
      where: eq(productAttributeValues.productId, productId),
    });
    return rows.map(rowToValue);
  }

  async setValue(input: {
    productId: string;
    attributeId: string;
    value: string;
    isVerified: boolean;
  }): Promise<PersistedAttributeValue> {
    const [row] = await db
      .insert(productAttributeValues)
      .values({
        productId: input.productId,
        attributeId: input.attributeId,
        value: input.value,
        isVerified: input.isVerified,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [productAttributeValues.productId, productAttributeValues.attributeId],
        set: {
          value: input.value,
          isVerified: input.isVerified,
          updatedAt: new Date(),
        },
      })
      .returning();
    return rowToValue(row);
  }
}
