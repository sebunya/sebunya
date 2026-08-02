import { sql } from 'drizzle-orm';
import { db } from '../client';
import { IProductQualityRepository } from '../../../application/ports/IProductQualityRepository';
import { ProductQualityInput } from '../../../domain/products/ProductQuality';

export class DrizzleProductQualityRepository implements IProductQualityRepository {
  async scanProducts(limit: number): Promise<ProductQualityInput[]> {
    const rows = (await db.execute(sql`
      select p.id as product_id,
             p.name,
             p.short_description,
             p.long_description,
             p.has_image,
             p.price_ugx,
             p.has_retail_price,
             p.category_name,
             p.model_number,
             p.warranty_period,
             (case when jsonb_typeof(p.specifications) = 'object'
                   then (select count(*)::int from jsonb_object_keys(p.specifications))
                   else 0 end) as specifications_count
      from products p
      order by p.created_at desc nulls last
      limit ${limit}
    `)) as unknown as any[];
    return rows.map((r) => ({
      productId: String(r.product_id),
      name: r.name ?? '',
      shortDescription: r.short_description ?? '',
      longDescription: r.long_description ?? '',
      hasImage: !!r.has_image,
      priceUgx: Number(r.price_ugx ?? 0),
      hasRetailPrice: !!r.has_retail_price,
      categoryName: r.category_name ?? null,
      modelNumber: r.model_number ?? '',
      warrantyPeriod: r.warranty_period ?? '',
      specificationsCount: Number(r.specifications_count ?? 0),
    }));
  }
}
