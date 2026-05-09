import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from '../apps/api/src/infrastructure/db/schema';
import crypto from 'crypto';

const runSeed = async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not defined');
  }

  console.log('Running safe seed script...');
  const connection = postgres(process.env.DATABASE_URL, { max: 1 });
  const db = drizzle(connection, { schema });

  // 1. Categories
  const powerCatId = crypto.randomUUID();
  const soundCatId = crypto.randomUUID();
  const otherCatId = crypto.randomUUID();

  await db.insert(schema.categories).values([
    { id: powerCatId, name: 'Power Devices', slug: 'power-devices', isOther: false },
    { id: soundCatId, name: 'Sound Devices', slug: 'sound-devices', isOther: false },
    { id: otherCatId, name: 'Other', slug: 'other', isOther: true },
  ]).onConflictDoNothing();

  // 2. Safe Products (No invented data)
  const productId1 = crypto.randomUUID();
  const productId2 = crypto.randomUUID();

  await db.insert(schema.products).values([
    {
      id: productId1,
      sku: 'PWR-CHG-001',
      modelNumber: 'Missing. Requires admin review.',
      name: 'Generic Fast Charger',
      slug: 'generic-fast-charger',
      categoryId: powerCatId,
      specifications: {
        wattage: 'Missing. Requires admin review.',
      },
      approvalStatus: 'approved',
      isFeedEligible: true,
      isPreOrderEnabled: false,
      hasRetailPrice: true,
      hasImage: false,
      stockQuantity: 50,
    },
    {
      id: productId2,
      sku: 'SND-EP-001',
      modelNumber: 'Missing. Requires admin review.',
      name: 'Wireless Earbuds',
      slug: 'wireless-earbuds',
      categoryId: soundCatId,
      specifications: {},
      approvalStatus: 'approved',
      isFeedEligible: true,
      isPreOrderEnabled: false,
      hasRetailPrice: true,
      hasImage: false,
      stockQuantity: 100,
    }
  ]).onConflictDoNothing();

  // 3. Product Prices
  await db.insert(schema.productPrices).values([
    {
      productId: productId1,
      retailPrice: 50000, // Safe default UGX
    },
    {
      productId: productId2,
      retailPrice: 80000,
    }
  ]).onConflictDoNothing();

  console.log('Seed complete! Safe sample data inserted.');
  process.exit(0);
};

runSeed().catch((err) => {
  console.error('Seed failed!', err);
  process.exit(1);
});
