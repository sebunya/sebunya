import { db } from '../client';
import { products, productPrices, categories } from '../schema/products';
import { productImages, productAttributeValues, attributes as attributesTable } from '../schema/phase11';
import { eq, inArray, and, or, ilike, SQL, asc, desc } from 'drizzle-orm';
import { ProductEntity, StockStatus } from '../../../domain/products/ProductEntity';
import { IProductRepository, ProductWithPrice } from '../../../application/ports/IProductRepository';
import { likeContains } from '../like';
import { searchTerms } from '../../../domain/products/ProductSearchService';

type PriceTierPatch = { floorPriceUgx?: number | null; tierBPriceUgx?: number | null; tierCPriceUgx?: number | null };
/** Only the tiers the caller supplied; an omitted tier is left as it was. */
function tierColumns(t: PriceTierPatch): Partial<typeof productPrices.$inferInsert> {
  const out: Partial<typeof productPrices.$inferInsert> = {};
  if (t.floorPriceUgx !== undefined) out.floorPrice = t.floorPriceUgx;
  if (t.tierBPriceUgx !== undefined) out.tierBPrice = t.tierBPriceUgx;
  if (t.tierCPriceUgx !== undefined) out.tierCPrice = t.tierCPriceUgx;
  return out;
}

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
      result.specifications as Record<string, string | number>,
      result.reservedQuantity ?? 0
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
      result.specifications as Record<string, string | number>,
      result.reservedQuantity ?? 0
    );
  }

  /**
   * Write a product, insert or update.
   *
   * TWO DEFECTS THIS CLOSES
   *
   * 1. The INSERT wrote a placeholder categoryId of all zeroes and relied on a
   *    follow-up UPDATE to put the real one in. `products.category_id` is NOT
   *    NULL with a NON-DEFERRABLE foreign key to `categories`, and no migration,
   *    baseline or seed ever creates a category with that id (confirmed against
   *    production: zero such rows). So the INSERT always raised a foreign-key
   *    violation and POST /admin/products answered 500: a product could not be
   *    created through the admin at all. The real category id is now written by
   *    the INSERT itself, which is also what makes the row valid at every instant
   *    rather than only after a second statement.
   *
   * 2. The conflict branch updated six columns. An operator editing a product
   *    could change its slug, its descriptions, its subcategory, its compare-at
   *    price, its stock status, its image, its features, its warranty, its
   *    specifications or its active flag, be told "Product updated", and have
   *    every one of those silently discarded. Everything the caller supplies is
   *    now written.
   *
   * `stockQuantity` remains deliberately absent from the update: on-hand stock is
   * owned by setStockQuantity, whose conditional UPDATE carries the
   * reserved <= stock invariant in its WHERE clause. Rewriting it from a property
   * save would reopen the read-then-write window that exists to close, and could
   * trip the database constraint as a raw 500. The INSERT still sets the initial
   * value when the product is created.
   */
  async save(product: ProductEntity, categoryId: string): Promise<void> {
    await db.insert(products).values({
      id: product.id,
      sku: product.sku,
      modelNumber: product.modelNumber,
      name: product.name,
      slug: product.slug,
      categoryId,
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
      // Every editable property, so an operator's save is not partly discarded.
      // See the note above for why stockQuantity is the one exception.
      set: {
        sku: product.sku,
        modelNumber: product.modelNumber,
        name: product.name,
        slug: product.slug,
        categoryId,
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
      result.specifications as Record<string, string | number>,
      result.reservedQuantity ?? 0
    ));
  }

  async findPublicViewBySlug(slug: string): Promise<ProductWithPrice | null> {
    const row = await db.query.products.findFirst({
      where: eq(products.slug, slug),
    });
    // Approved AND active. The SEO lifecycle, the sitemap and the recommender
    // all treat active = false as discontinued; the public readers ignored it,
    // so a deactivated product stayed listed, searchable and purchasable.
    if (!row || row.approvalStatus !== 'approved' || !row.active) return null;

    const [priceRow, categoryRow, imageRows, valueRows] = await Promise.all([
      db.query.productPrices.findFirst({ where: eq(productPrices.productId, row.id) }),
      db.query.categories.findFirst({ where: eq(categories.id, row.categoryId) }),
      db.query.productImages.findMany({
        where: eq(productImages.productId, row.id),
        orderBy: [asc(productImages.displayOrder)],
      }),
      db.query.productAttributeValues.findMany({ where: eq(productAttributeValues.productId, row.id) }),
    ]);

    const attrIds = Array.from(new Set(valueRows.map((v) => v.attributeId)));
    const attrRows = attrIds.length
      ? await db.query.attributes.findMany({ where: inArray(attributesTable.id, attrIds) })
      : [];
    const attrById = new Map(attrRows.map((a) => [a.id, a]));

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
      (row.specifications ?? {}) as Record<string, string | number>,
      row.reservedQuantity ?? 0
    );

    return {
      entity,
      retailPriceUgx: row.hasRetailPrice && priceRow?.retailPrice ? priceRow.retailPrice : null,
      floorPriceUgx: priceRow?.floorPrice ?? null,
      categoryName: categoryRow?.name ?? row.categoryName ?? null,
      images: imageRows.map((i) => ({
        url: i.url,
        altText: i.altText ?? null,
        displayOrder: i.displayOrder,
        isPrimary: i.isPrimary,
      })),
      attributeValues: valueRows
        .map((v) => {
          const attr = attrById.get(v.attributeId);
          if (!attr) return null;
          return { attributeName: attr.name, unit: attr.unit ?? null, value: v.value, isVerified: v.isVerified };
        })
        .filter((x): x is { attributeName: string; unit: string | null; value: string; isVerified: boolean } => x !== null),
    };
  }

  async findPublicViewList(opts: {
    limit?: number;
    offset?: number;
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
      eq(products.active, true),
    ];

    if (targetCategoryId) {
      conditions.push(eq(products.categoryId, targetCategoryId));
    }

    if (opts.inStock) {
      conditions.push(eq(products.stockStatus, 'in_stock'));
    }

    if (opts.search) {
      // The autocomplete and the /shop results page must agree on what a query
      // matches, or the dropdown says "nothing found" for a term the results
      // page has products for. These are the same five fields the storefront
      // filter reads, and both are denormalised onto products, so no join.
      // Every word must appear somewhere, in any order, so "bank power" finds
      // the power bank; a whole-phrase match is simply the one-word case.
      const terms = searchTerms(opts.search);
      for (const term of terms) {
        const needle = likeContains(term);
        conditions.push(
          or(
            ilike(products.name, needle),
            ilike(products.categoryName, needle),
            // ...and the joined category, which is what the storefront DTO
            // actually shows. products.category_name is a denormalised copy;
            // matching only the copy would silently reopen the dropdown /
            // results-page divergence the moment the two drift.
            inArray(
              products.categoryId,
              db.select({ id: categories.id }).from(categories).where(ilike(categories.name, needle)),
            ),
            ilike(products.subcategory, needle),
            ilike(products.modelNumber, needle),
            ilike(products.sku, needle)
          )
        );
      }
    }

    if (opts.ids && opts.ids.length > 0) {
      conditions.push(inArray(products.id, opts.ids));
    }

    const rows = await db.query.products.findMany({
      where: and(...conditions),
      limit: opts.limit ?? 60,
      offset: opts.offset,
      // Without an explicit order Postgres returns rows in physical order,
      // which reshuffles whenever a product is edited: the shop's default
      // order was arbitrary, and paging over it would skip and repeat rows.
      // Newest first, id breaking ties so the sequence is total and stable.
      orderBy: [desc(products.createdAt), asc(products.id)],
    });
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const categoryIds = Array.from(new Set(rows.map((r) => r.categoryId)));

    const [priceRows, categoryRows, imageRows, valueRows] = await Promise.all([
      db.query.productPrices.findMany({ where: inArray(productPrices.productId, ids) }),
      db.query.categories.findMany({ where: inArray(categories.id, categoryIds) }),
      db.query.productImages.findMany({
        where: inArray(productImages.productId, ids),
        orderBy: [asc(productImages.displayOrder)],
      }),
      db.query.productAttributeValues.findMany({ where: inArray(productAttributeValues.productId, ids) }),
    ]);

    const attrIds = Array.from(new Set(valueRows.map((v) => v.attributeId)));
    const attrRows = attrIds.length
      ? await db.query.attributes.findMany({ where: inArray(attributesTable.id, attrIds) })
      : [];
    const attrById = new Map(attrRows.map((a) => [a.id, a]));

    const priceByProduct = new Map(priceRows.map((p) => [p.productId, p.retailPrice]));
    const floorByProduct = new Map(priceRows.map((p) => [p.productId, p.floorPrice ?? null]));
    const categoryById = new Map(categoryRows.map((c) => [c.id, c.name]));

    const imagesByProduct = new Map<string, typeof imageRows>();
    for (const img of imageRows) {
      const group = imagesByProduct.get(img.productId) ?? [];
      group.push(img);
      imagesByProduct.set(img.productId, group);
    }
    const valuesByProduct = new Map<string, typeof valueRows>();
    for (const v of valueRows) {
      const group = valuesByProduct.get(v.productId) ?? [];
      group.push(v);
      valuesByProduct.set(v.productId, group);
    }

    return rows.map((row) => {
      const rowImages = imagesByProduct.get(row.id) ?? [];
      const rowValues = valuesByProduct.get(row.id) ?? [];

      return {
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
          (row.specifications ?? {}) as Record<string, string | number>,
          row.reservedQuantity ?? 0
        ),
        retailPriceUgx: row.hasRetailPrice ? priceByProduct.get(row.id) ?? null : null,
        floorPriceUgx: floorByProduct.get(row.id) ?? null,
        categoryName: categoryById.get(row.categoryId) ?? row.categoryName ?? null,
        images: rowImages.map((i) => ({
          url: i.url,
          altText: i.altText ?? null,
          displayOrder: i.displayOrder,
          isPrimary: i.isPrimary,
        })),
        attributeValues: rowValues
          .map((v) => {
            const attr = attrById.get(v.attributeId);
            if (!attr) return null;
            return { attributeName: attr.name, unit: attr.unit ?? null, value: v.value, isVerified: v.isVerified };
          })
          .filter((x): x is { attributeName: string; unit: string | null; value: string; isVerified: boolean } => x !== null),
      };
    });
  }

  async getCategories(): Promise<Array<{ id: string; name: string; slug: string; isOther: boolean }>> {
    return await db.query.categories.findMany();
  }

  /**
   * Make every taxonomy category FILEABLE. The storefront browses by the
   * taxonomy, but a product can only be filed into this table, so a category
   * added to the taxonomy alone was browsable and empty forever — no product
   * could be put in it. Additive and idempotent: it creates what is missing,
   * matching on slug, and never renames or removes anything.
   */
  async ensureCategories(wanted: Array<{ name: string; slug: string }>): Promise<string[]> {
    if (wanted.length === 0) return [];
    const existing = await db.select({ name: categories.name, slug: categories.slug }).from(categories);
    const haveSlug = new Set(existing.map((c) => c.slug));
    const haveName = new Set(existing.map((c) => c.name));
    const created: string[] = [];
    for (const category of wanted) {
      if (!category.name || !category.slug) continue;
      if (haveSlug.has(category.slug) || haveName.has(category.name)) continue;
      await db.insert(categories).values({ name: category.name, slug: category.slug }).onConflictDoNothing();
      haveSlug.add(category.slug);
      haveName.add(category.name);
      created.push(category.name);
    }
    return created;
  }

  async checkCategoryExists(categoryId: string): Promise<boolean> {
    const cat = await db.query.categories.findFirst({ where: eq(categories.id, categoryId) });
    return !!cat;
  }

  async checkSkuExists(sku: string, excludeId?: string): Promise<boolean> {
    const rows = await db.select().from(products).where(eq(products.sku, sku));
    if (excludeId) {
      return rows.some(r => r.id !== excludeId);
    }
    return rows.length > 0;
  }

  async checkSlugExists(slug: string, excludeId?: string): Promise<boolean> {
    const rows = await db.select().from(products).where(eq(products.slug, slug));
    if (excludeId) {
      return rows.some(r => r.id !== excludeId);
    }
    return rows.length > 0;
  }

  async createProduct(product: ProductEntity, categoryId: string, tiers: PriceTierPatch = {}): Promise<void> {
    // The real category goes in with the INSERT; there is no window in which the
    // row names a category that does not exist.
    await this.save(product, categoryId);
    await db.insert(productPrices).values({
      productId: product.id,
      retailPrice: product.priceUgx,
      ...tierColumns(tiers),
    });
  }

  /**
   * The product's own price tiers. The floor (Price A) is the one the engine
   * reads; B and C are preserved from the owner's price list. Validated by the
   * caller AND by the database CHECK: a floor may never exceed the retail price.
   */
  async setPriceTiers(
    productId: string,
    tiers: { floorPriceUgx?: number | null; tierBPriceUgx?: number | null; tierCPriceUgx?: number | null },
  ): Promise<void> {
    const patch: Partial<typeof productPrices.$inferInsert> = {};
    if (tiers.floorPriceUgx !== undefined) patch.floorPrice = tiers.floorPriceUgx;
    if (tiers.tierBPriceUgx !== undefined) patch.tierBPrice = tiers.tierBPriceUgx;
    if (tiers.tierCPriceUgx !== undefined) patch.tierCPrice = tiers.tierCPriceUgx;
    if (Object.keys(patch).length === 0) return;
    await db.update(productPrices).set(patch).where(eq(productPrices.productId, productId));
  }

  async getPriceTiers(productId: string): Promise<{ floorPriceUgx: number | null; tierBPriceUgx: number | null; tierCPriceUgx: number | null }> {
    const row = await db.query.productPrices.findFirst({ where: eq(productPrices.productId, productId) });
    return { floorPriceUgx: row?.floorPrice ?? null, tierBPriceUgx: row?.tierBPrice ?? null, tierCPriceUgx: row?.tierCPrice ?? null };
  }

  async updateProductProperties(product: ProductEntity, categoryId: string, tiers: PriceTierPatch = {}): Promise<void> {
    await this.save(product, categoryId);
    const priceRow = await db.query.productPrices.findFirst({ where: eq(productPrices.productId, product.id) });
    // Retail and tiers in ONE statement. Written separately, lowering the price
    // below the OLD floor tripped the database CHECK between the two writes and
    // surfaced as a 500 instead of the validation message the route already gave.
    if (priceRow) {
      await db.update(productPrices).set({ retailPrice: product.priceUgx, ...tierColumns(tiers) }).where(eq(productPrices.productId, product.id));
    } else {
      await db.insert(productPrices).values({ productId: product.id, retailPrice: product.priceUgx, ...tierColumns(tiers) });
    }
  }
}

