import { and, eq } from 'drizzle-orm';
import { ICopyQualityCatalogReader } from '../../../application/ports/ICopyQualityCatalogReader';
import { db } from '../client'; import { products } from '../schema/products';
export class DrizzleCopyQualityCatalogReader implements ICopyQualityCatalogReader {
  async list(input: { approvalStatus?: string; active?: boolean }) { const conditions = []; if (input.approvalStatus) conditions.push(eq(products.approvalStatus, input.approvalStatus)); if (input.active !== undefined) conditions.push(eq(products.active, input.active)); const rows = await db.select({ id: products.id, sku: products.sku, name: products.name, modelNumber: products.modelNumber, shortDescription: products.shortDescription, longDescription: products.longDescription, approvalStatus: products.approvalStatus, active: products.active }).from(products).where(conditions.length ? and(...conditions) : undefined).orderBy(products.sku); return rows; }
}
