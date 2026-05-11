import { db } from '../client';
import { products, productPrices, categories } from '../schema/products';
import { eq, inArray, and, or, ilike, SQL } from 'drizzle-orm';
import { ProductEntity, StockStatus } from '../../../domain/products/ProductEntity';
import { IProductRepository, ProductWithPrice } from '../../../application/ports/IProductRepository';

export class DrizzleProductRepository implements IProductRepository {
  async findBySlug(slug: string): Promise<ProductEntity | null> {
    const result = await db.query.products.findFirst({
      where: eq(products.slug, slug),
    });

    if (!result) return null;

    return new ProductEntity(
      result.id,
      result.sku,
      result.modelNumber,
      result.name,
      result.slug,
      result.categoryName ?? 'Uncategorized',
      result.subcategory ?? undefined,
      result.shortDescription,
      result.longDescription,
      result.priceUgx,
      result.compareAtPriceUgx ?? undefined,
      result.stockStatus as StockStatus,
      result.imageUrl ?? undefined,
      result.features as string[],
      result.warrantyPeriod,
      result.verificationEligible,
      result.active,
      result.approvalStatus as 'draft' | 'approved' | 'rejected',
      result.isPreOrderEnabled,
      result.hasRetailPrice,
      result.hasImage,
      result.stockQuantity,
      result.specifications as Record<string, string | number>
    );
  }

  async findById(id: string): Promise<ProductEntity | null> {
    const result = await db.query.products.findFirst({
      where: eq(products.id, id),
    });

    if (!result) return null;

    return new ProductEntity(
      result.id,
      result.sku,
      result.modelNumber,
      result.name,
      result.slug,
      result.categoryName ?? 'Uncategorized',
      result.subcategory ?? undefined,
      result.shortDescription,
      result.longDescription,
      result.priceUgx,
      result.compareAtPriceUgx ?? undefined,
      result.stockStatus as StockStatus,
      result.imageUrl ?? undefined,
      result.features as string[],
      result.warrantyPeriod,
      result.verificationEligible,
      result.active,
      result.approvalStatus as 'draft' | 'approved' | 'rejected',
      result.isPreOrderEnabled,
      result.hasRetailPrice,
      result.hasImage,
      result.stockQuantity,
      result.specifications as Record<string, string | number>
    );
  }

  async save(product: ProductEntity): Promise<void> {
    await db.insert(products).values({
      id: product.id,
      sku: product.sku,
      modelNumber: product.modelNumber,
      name: product.name,
      slug: product.slug,
      categoryId: '00000000-0000-0000-0000-000000000000', // Generic Category placeholder
      categoryName: product.category,
      subcategory: product.subcategory,
      shortDescription: product.shortDescription,
      longDescription: product.longDescription,
      priceUgx: product.priceUgx,
      compareAtPriceUgx: product.compareAtPriceUgx,
      stockStatus: product.stockStatus,
      imageUrl: product.imageUrl,
      features: product.features,
      warrantyPeriod: product.warrantyPeriod,
      verificationEligible: product.verificationEligible,
      active: product.active,
      specifications: product.specifications,
      approvalStatus: product.approvalStatus,
      isPreOrderEnabled: product.isPreOrderEnabled,
      hasRetailPrice: product.hasRetailPrice,
      hasImage: product.hasImage,
      stockQuantity: product.stockQuantity,
    }).onConflictDoUpdate({
      target: products.id,
      set: {
        sku: product.sku,
        modelNumber: product.modelNumber,
        name: product.name,
        categoryName: product.category,
        priceUgx: product.priceUgx,
        approvalStatus: product.approvalStatus,
        stockQuantity: product.stockQuantity,
      }
    });
  }

  async findAll(): Promise<ProductEntity[]> {
    const results = await db.query.products.findMany();
    return results.map(result => new ProductEntity(
      result.id,
      result.sku,
      result.modelNumber,
      result.name,
      result.slug,
      result.categoryName ?? 'Uncategorized',
      result.subcategory ?? undefined,
      result.shortDescription,
      result.longDescription,
      result.priceUgx,
      result.compareAtPriceUgx ?? undefined,
      result.stockStatus as StockStatus,
      result.imageUrl ?? undefined,
      result.features as string[],
      result.warrantyPeriod,
      result.verificationEligible,
      result.active,
      result.approvalStatus as 'draft' | 'approved' | 'rejected',
      result.isPreOrderEnabled,
      result.hasRetailPrice,
      result.hasImage,
      result.stockQuantity,
      result.specifications as Record<string, string | number>
    ));
  }

  async findPublicViewBySlug(slug: string): Promise<ProductWithPrice | null> {
    const row = await db.query.products.findFirst({
      where: eq(products.slug, slug),
    });
    if (!row) return null;

    if (row.approvalStatus !== 'approved') return null;

    const [priceRow, categoryRow] = await Promise.all([
      db.query.productPrices.findFirst({
        where: eq(productPrices.productId, row.id),
      }),
      db.query.categories.findFirst({
        where: eq(categories.id, row.categoryId),
      }),
    ]);

    const entity = new ProductEntity(
      row.id,
      row.sku,
      row.modelNumber,
      row.name,
      row.slug,
      row.categoryName ?? 'Uncategorized',
      row.subcategory ?? undefined,
      row.shortDescription,
      row.longDescription,
      row.priceUgx,
      row.compareAtPriceUgx ?? undefined,
      row.stockStatus as StockStatus,
      row.imageUrl ?? undefined,
      row.features as string[],
      row.warrantyPeriod,
      row.verificationEligible,
      row.active,
      row.approvalStatus as 'draft' | 'approved' | 'rejected',
      row.isPreOrderEnabled,
      row.hasRetailPrice,
      row.hasImage,
      row.stockQuantity,
      (row.specifications ?? {}) as Record<string, string | number>
    );

    return {
      entity,
      retailPriceUgx: row.hasRetailPrice && priceRow?.retailPrice ? priceRow.retailPrice : null,
      categoryName: categoryRow?.name ?? row.categoryName ?? null,
    };
  }

  async findPublicViewList(opts: {
    limit?: number;
    search?: string;
    category?: string;
    inStock?: boolean;
    ids?: string[];
  } = {}): Promise<ProductWithPrice[]> {
    let targetCategoryId: string | undefined;
    if (opts.category && opts.category !== 'all') {
      const foundCat = await db.query.categories.findFirst({
        where: eq(categories.slug, opts.category),
      });
      if (foundCat) {
        targetCategoryId = foundCat.id;
      } else {
        // If valid category search requested but none found, return empty
        return [];
      }
    }

    const conditions: (SQL | undefined)[] = [
      eq(products.approvalStatus, 'approved'),
    ];

    if (targetCategoryId) {
      conditions.push(eq(products.categoryId, targetCategoryId));
    }

    if (opts.inStock) {
      conditions.push(eq(products.stockStatus, 'in_stock'));
    }

    if (opts.search) {
      const needle = `%${opts.search}%`;
      conditions.push(
        or(
          ilike(products.name, needle),
          ilike(products.modelNumber, needle),
          ilike(products.sku, needle)
        )
      );
    }

    if (opts.ids && opts.ids.length > 0) {
      conditions.push(inArray(products.id, opts.ids));
    }

    const rows = await db.query.products.findMany({
      where: and(...conditions),
      limit: opts.limit ?? 60,
    });
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const categoryIds = Array.from(new Set(rows.map((r) => r.categoryId)));

    const [priceRows, categoryRows] = await Promise.all([
      db.query.productPrices.findMany({ where: inArray(productPrices.productId, ids) }),
      db.query.categories.findMany({ where: inArray(categories.id, categoryIds) }),
    ]);

    const priceByProduct = new Map(priceRows.map((p) => [p.productId, p.retailPrice]));
    const categoryById = new Map(categoryRows.map((c) => [c.id, c.name]));

    return rows.map((row) => ({
      entity: new ProductEntity(
        row.id,
        row.sku,
        row.modelNumber,
        row.name,
        row.slug,
        row.categoryName ?? 'Uncategorized',
        row.subcategory ?? undefined,
        row.shortDescription,
        row.longDescription,
        row.priceUgx,
        row.compareAtPriceUgx ?? undefined,
        row.stockStatus as StockStatus,
        row.imageUrl ?? undefined,
        row.features as string[],
        row.warrantyPeriod,
        row.verificationEligible,
        row.active,
        row.approvalStatus as 'draft' | 'approved' | 'rejected',
        row.isPreOrderEnabled,
        row.hasRetailPrice,
        row.hasImage,
        row.stockQuantity,
        (row.specifications ?? {}) as Record<string, string | number>
      ),
      retailPriceUgx: row.hasRetailPrice ? priceByProduct.get(row.id) ?? null : null,
      categoryName: categoryById.get(row.categoryId) ?? row.categoryName ?? null,
    }));
  }
}

