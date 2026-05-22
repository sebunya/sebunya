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
  const powerCatId = '07dd081e-c3c9-415f-a632-8dc427e9da83';
  const soundCatId = '19f830b4-9b01-4676-b253-329f97fd4c82';
  const otherCatId = '043c8aeb-f1c2-4a1e-9753-a78dd2d5aaef';

  await db.insert(schema.categories).values([
    { id: powerCatId, name: 'Power Devices', slug: 'power-devices', isOther: false },
    { id: soundCatId, name: 'Sound Devices', slug: 'sound-devices', isOther: false },
    { id: otherCatId, name: 'Other', slug: 'other', isOther: true },
  ]).onConflictDoNothing();

  // 2. Deterministic Safe Products
  const productId1 = '68001def-f81c-46e3-903e-c3b51e34e8b1';
  const productId2 = '27b396dd-55c1-4181-9772-aec1bf4a3dcf';
  const productId3 = '9a7f612b-68e9-47d5-b9ea-442bc7690a02';
  const productId4 = 'bc1901fa-cfde-49ad-9ccf-818724bbdc6d';
  const productId5 = 'fa7e1a81-c640-4283-bd52-a5d4429ef1e1';
  const productId6 = 'ca8f3d1b-467f-41d1-a461-78a89dc9c201';
  const productId7 = '7a1e42b9-e278-4b49-af1f-c19bbddcae3a';
  const productId8 = '8d1fbc20-a7c8-4122-8b0e-89aa39c654b2';

  await db.insert(schema.products).values([
    {
      id: productId1,
      sku: 'PWR-CHG-001',
      modelNumber: 'GP-FC-20W',
      name: 'Generic Fast Charger',
      slug: 'generic-fast-charger',
      categoryId: powerCatId,
      categoryName: 'Power Devices',
      specifications: { wattage: '20W' },
      approvalStatus: 'approved',
      isFeedEligible: true,
      isPreOrderEnabled: false,
      hasRetailPrice: true,
      hasImage: true,
      priceUgx: 18000,
      imageUrl: 'https://images.unsplash.com/photo-1600003263720-95b45a4035d5?auto=format&fit=crop&q=80&w=600',
      stockQuantity: 50,
    },
    {
      id: productId2,
      sku: 'SND-EP-001',
      modelNumber: 'GP-WE-X1',
      name: 'Wireless Earbuds',
      slug: 'wireless-earbuds',
      categoryId: soundCatId,
      categoryName: 'Sound Devices',
      specifications: {},
      approvalStatus: 'approved',
      isFeedEligible: true,
      isPreOrderEnabled: false,
      hasRetailPrice: true,
      hasImage: true,
      priceUgx: 18000,
      imageUrl: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?auto=format&fit=crop&q=80&w=600',
      stockQuantity: 100,
    },
    {
      id: productId3,
      sku: 'PWR-CBL-002',
      modelNumber: 'GP-UC-2M',
      name: 'Reinforced USB-C Cable',
      slug: 'reinforced-usb-c-cable',
      categoryId: powerCatId,
      categoryName: 'Power Devices',
      specifications: { length: '2 Meters' },
      approvalStatus: 'approved',
      isFeedEligible: true,
      isPreOrderEnabled: false,
      hasRetailPrice: true,
      hasImage: true,
      priceUgx: 18000,
      imageUrl: 'https://images.unsplash.com/photo-1612815154858-60aa4c59eaa6?auto=format&fit=crop&q=80&w=600',
      stockQuantity: 200,
    },
    {
      id: productId4,
      sku: 'PWR-PBK-003',
      modelNumber: 'GP-PB-20K',
      name: 'Heavy Duty Power Bank',
      slug: 'heavy-duty-power-bank',
      categoryId: powerCatId,
      categoryName: 'Power Devices',
      specifications: { capacity: '20,000 mAh' },
      approvalStatus: 'approved',
      isFeedEligible: true,
      isPreOrderEnabled: false,
      hasRetailPrice: true,
      hasImage: true,
      priceUgx: 18000,
      imageUrl: 'https://images.unsplash.com/photo-1609081219090-a6d81d3085bf?auto=format&fit=crop&q=80&w=600',
      stockQuantity: 30,
    },
    {
      id: productId5,
      sku: 'SND-SPK-004',
      modelNumber: 'GP-BS-05',
      name: 'Bluetooth Rugged Speaker',
      slug: 'bluetooth-rugged-speaker',
      categoryId: soundCatId,
      categoryName: 'Sound Devices',
      specifications: {},
      approvalStatus: 'approved',
      isFeedEligible: true,
      isPreOrderEnabled: false,
      hasRetailPrice: true,
      hasImage: true,
      priceUgx: 18000,
      imageUrl: 'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?auto=format&fit=crop&q=80&w=600',
      stockQuantity: 45,
    },
    {
      id: productId6,
      sku: 'ACC-MT-005',
      modelNumber: 'GP-CM-HD',
      name: 'Car Dashboard Mount',
      slug: 'car-dashboard-mount',
      categoryId: otherCatId,
      categoryName: 'Other',
      specifications: {},
      approvalStatus: 'approved',
      isFeedEligible: true,
      isPreOrderEnabled: false,
      hasRetailPrice: true,
      hasImage: true,
      priceUgx: 18000,
      imageUrl: 'https://images.unsplash.com/photo-1586105251261-72a756497a11?auto=format&fit=crop&q=80&w=600',
      stockQuantity: 120,
    },
    {
      id: productId7,
      sku: 'STR-FL-006',
      modelNumber: 'GP-FD-128G',
      name: 'USB 3.0 Flash Drive 128GB',
      slug: 'usb-3-flash-drive-128gb',
      categoryId: otherCatId,
      categoryName: 'Other',
      specifications: { storage: '128GB' },
      approvalStatus: 'approved',
      isFeedEligible: true,
      isPreOrderEnabled: false,
      hasRetailPrice: true,
      hasImage: true,
      priceUgx: 18000,
      imageUrl: 'https://images.unsplash.com/photo-1618424181497-157f25b6ddd5?auto=format&fit=crop&q=80&w=600',
      stockQuantity: 80,
    },
    {
      id: productId8,
      sku: 'SND-HD-007',
      modelNumber: 'GP-PH-02',
      name: 'Portable Audio Headset',
      slug: 'portable-audio-headset',
      categoryId: soundCatId,
      categoryName: 'Sound Devices',
      specifications: {},
      approvalStatus: 'approved',
      isFeedEligible: true,
      isPreOrderEnabled: false,
      hasRetailPrice: true,
      hasImage: true,
      priceUgx: 18000,
      imageUrl: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&q=80&w=600',
      stockQuantity: 25,
    }
  ]).onConflictDoNothing();

  // 3. Product Prices
  await db.insert(schema.productPrices).values([
    { productId: productId1, retailPrice: 18000 },
    { productId: productId2, retailPrice: 18000 },
    { productId: productId3, retailPrice: 18000 },
    { productId: productId4, retailPrice: 18000 },
    { productId: productId5, retailPrice: 18000 },
    { productId: productId6, retailPrice: 18000 },
    { productId: productId7, retailPrice: 18000 },
    { productId: productId8, retailPrice: 18000 }
  ]).onConflictDoNothing();

  // 4. Authoritative Product Images
  await db.insert(schema.productImages).values([
    { productId: productId1, url: 'https://images.unsplash.com/photo-1600003263720-95b45a4035d5?auto=format&fit=crop&q=80&w=600', altText: 'Generic Fast Charger Plug', isPrimary: true, displayOrder: 0 },
    { productId: productId2, url: 'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?auto=format&fit=crop&q=80&w=600', altText: 'Wireless Earbuds with Charging Case', isPrimary: true, displayOrder: 0 },
    { productId: productId3, url: 'https://images.unsplash.com/photo-1612815154858-60aa4c59eaa6?auto=format&fit=crop&q=80&w=600', altText: 'Reinforced USB-C Cable', isPrimary: true, displayOrder: 0 },
    { productId: productId4, url: 'https://images.unsplash.com/photo-1609081219090-a6d81d3085bf?auto=format&fit=crop&q=80&w=600', altText: 'Heavy Duty Power Bank', isPrimary: true, displayOrder: 0 },
    { productId: productId5, url: 'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?auto=format&fit=crop&q=80&w=600', altText: 'Bluetooth Rugged Speaker', isPrimary: true, displayOrder: 0 },
    { productId: productId6, url: 'https://images.unsplash.com/photo-1586105251261-72a756497a11?auto=format&fit=crop&q=80&w=600', altText: 'Car Dashboard Mount', isPrimary: true, displayOrder: 0 },
    { productId: productId7, url: 'https://images.unsplash.com/photo-1618424181497-157f25b6ddd5?auto=format&fit=crop&q=80&w=600', altText: 'USB 3.0 Flash Drive', isPrimary: true, displayOrder: 0 },
    { productId: productId8, url: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&q=80&w=600', altText: 'Portable Audio Headset', isPrimary: true, displayOrder: 0 }
  ]).onConflictDoNothing();

  console.log('Seed complete! Safe sample data inserted.');
  process.exit(0);
};

runSeed().catch((err) => {
  console.error('Seed failed!', err);
  process.exit(1);
});
