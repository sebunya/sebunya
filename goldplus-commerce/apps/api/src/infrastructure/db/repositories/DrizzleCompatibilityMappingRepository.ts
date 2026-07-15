import { eq, and, desc } from 'drizzle-orm';
import { db } from '../client';
import { productCompatibilityMappings } from '../schema/compatibility';
import { ICompatibilityMappingRepository } from '../../../application/ports/ICompatibilityMappingRepository';
import { CompatibilityMapping, CompatibilityMappingInput, DeclaredVerdict } from '../../../domain/products/Compatibility';

function toDomain(row: typeof productCompatibilityMappings.$inferSelect): CompatibilityMapping {
  return {
    id: row.id,
    productId: row.productId,
    targetProductId: row.targetProductId,
    verdict: row.verdict as DeclaredVerdict,
    note: row.note,
    enabled: row.enabled,
  };
}

export class DrizzleCompatibilityMappingRepository implements ICompatibilityMappingRepository {
  async listAll(limit = 500): Promise<CompatibilityMapping[]> {
    const rows = await db.query.productCompatibilityMappings.findMany({
      orderBy: [desc(productCompatibilityMappings.updatedAt)],
      limit: Math.max(1, Math.min(limit, 1000)),
    });
    return rows.map(toDomain);
  }

  async listForProduct(productId: string): Promise<CompatibilityMapping[]> {
    const rows = await db.query.productCompatibilityMappings.findMany({
      where: and(
        eq(productCompatibilityMappings.productId, productId),
        eq(productCompatibilityMappings.enabled, true)
      ),
    });
    return rows.map(toDomain);
  }

  async upsert(input: CompatibilityMappingInput): Promise<CompatibilityMapping> {
    const [row] = await db
      .insert(productCompatibilityMappings)
      .values({
        productId: input.productId,
        targetProductId: input.targetProductId,
        verdict: input.verdict,
        note: input.note,
        enabled: input.enabled,
      })
      .onConflictDoUpdate({
        target: [productCompatibilityMappings.productId, productCompatibilityMappings.targetProductId],
        set: { verdict: input.verdict, note: input.note, enabled: input.enabled, updatedAt: new Date() },
      })
      .returning();
    return toDomain(row);
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await db
      .delete(productCompatibilityMappings)
      .where(eq(productCompatibilityMappings.id, id))
      .returning({ id: productCompatibilityMappings.id });
    return deleted.length > 0;
  }
}
