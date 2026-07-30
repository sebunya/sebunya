/**
 * Seeds the minimum a real checkout needs, through the application's own schema.
 *
 * Written against the Drizzle schema rather than as raw INSERTs so a column the
 * harness relies on cannot silently differ from the one the code writes — a seed
 * that drifts from the schema produces a harness that tests a fiction.
 *
 * Deliberately minimal: one category, one in-stock product with a retail price, and
 * one delivery zone. Anything more would make a failure harder to attribute.
 */
import { randomUUID } from 'node:crypto';
import { db, client } from '../../apps/api/src/infrastructure/db/client';
import { categories, products, productPrices } from '../../apps/api/src/infrastructure/db/schema/products';
import { deliveryZones } from '../../apps/api/src/infrastructure/db/schema/commerce';

const PRODUCT_PRICE_UGX = 250_000;
const STOCK = 25;
export const SEED_DISTRICT = 'Kampala';

async function main(): Promise<void> {
  const categoryId = randomUUID();
  await db.insert(categories).values({
    id: categoryId,
    name: 'Harness Category',
    slug: `harness-category-${categoryId.slice(0, 8)}`,
  });

  const productId = randomUUID();
  await db.insert(products).values({
    id: productId,
    sku: `E2E-${productId.slice(0, 8)}`,
    modelNumber: 'E2E-MODEL-1',
    name: 'Harness Test Product',
    slug: `harness-test-product-${productId.slice(0, 8)}`,
    categoryId,
    categoryName: 'Harness Category',
    shortDescription: 'Seeded by the end-to-end checkout harness.',
    priceUgx: PRODUCT_PRICE_UGX,
    stockStatus: 'in_stock',
    stockQuantity: STOCK,
    reservedQuantity: 0,
    // Explicit, not defaulted: the reservation path must be the STOCK_CONTROLLED
    // one, which is the path that can fail closed.
    inventoryPolicy: 'STOCK_CONTROLLED',
    active: true,
    approvalStatus: 'approved',
    hasRetailPrice: true,
  });

  // Pricing is server-authoritative and read from here, not from the product row,
  // so a missing price row would make every checkout fail for the wrong reason.
  await db.insert(productPrices).values({
    productId,
    retailPrice: PRODUCT_PRICE_UGX,
  });

  await db
    .insert(deliveryZones)
    .values({ district: SEED_DISTRICT, feeUgx: 15_000, enabled: true })
    .onConflictDoNothing();

  // Emitted for the proofs driver to read. Ids only — no customer data exists yet.
  process.stdout.write(
    `${JSON.stringify({ productId, priceUgx: PRODUCT_PRICE_UGX, stock: STOCK, district: SEED_DISTRICT })}\n`,
  );
}

main()
  .then(async () => {
    await client.end({ timeout: 5 });
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('SEED_FAILED:', error);
    await client.end({ timeout: 5 }).catch(() => undefined);
    process.exit(1);
  });
