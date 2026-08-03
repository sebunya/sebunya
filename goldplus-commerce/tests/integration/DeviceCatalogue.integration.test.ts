import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleDeviceRepository } from '../../apps/api/src/infrastructure/db/repositories/DrizzleDeviceRepository';

/**
 * U2 — device catalogue queries + bulk import, on real PostgreSQL.
 *   AC1 compatible products: ONE query, ordered fit_type then popularity.
 *   AC3 accessory suggestions: ≤3, excluding in-cart / inactive / unapproved /
 *       out-of-stock.
 *   AC5 bulk import: whole file validated + refs resolved before any commit.
 *   AC2 alias resolution with ambiguity detection.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('device catalogue (real PostgreSQL, U2)', () => {
  let raw: any;
  const repo = new DrizzleDeviceRepository();
  let categoryId: string;
  const productIds: Record<string, string> = {};
  const deviceIds: string[] = [];
  const skus: Record<string, string> = {};

  const mkProduct = async (key: string, opts: { active?: boolean; approval?: string; stock?: string } = {}) => {
    const s = `dv-${key}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.slice(0, 40);
    const [p] = await raw`
      insert into products (sku, model_number, name, slug, category_id, active, approval_status, stock_status)
      values (${s}, ${s}, ${'Prod ' + key}, ${s}, ${categoryId}, ${opts.active ?? true}, ${opts.approval ?? 'approved'}, ${opts.stock ?? 'in_stock'})
      returning id`;
    productIds[key] = p.id;
    skus[key] = s;
    return p.id as string;
  };
  const linkCompat = async (productKey: string, deviceId: string, fit: string, confidence = 'declared') => {
    await raw`insert into product_device_compatibility (product_id, device_id, fit_type, confidence) values (${productIds[productKey]}, ${deviceId}, ${fit}, ${confidence})`;
  };

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const postgres = require('../../apps/api/node_modules/postgres');
    raw = postgres(URL!, { max: 4, prepare: false });
    const s = `devcat-${Date.now()}`;
    const [cat] = await raw`insert into categories (name, slug) values (${s}, ${s}) returning id`;
    categoryId = cat.id;
  });

  afterAll(async () => {
    if (!raw) return;
    if (deviceIds.length) await raw`delete from product_device_compatibility where device_id = any(${deviceIds})`;
    const pids = Object.values(productIds);
    if (pids.length) await raw`delete from products where id = any(${pids})`;
    if (deviceIds.length) await raw`delete from devices where id = any(${deviceIds})`;
    await raw`delete from categories where id = ${categoryId}`;
    await raw.end();
  });

  it('AC2: resolves a device by alias and flags ambiguity', async () => {
    const spark = await repo.createDevice({ brand: 'Tecno', model: 'Spark 20', modelAliases: ['Tecno Spark 20', 'spark twenty'] });
    deviceIds.push(spark.id);
    const resolved = await repo.resolveDeviceQuery('  spark  TWENTY ');
    expect(resolved).toEqual({ kind: 'RESOLVED', deviceId: spark.id });
    expect(await repo.resolveDeviceQuery('Pixel 9')).toEqual({ kind: 'NOT_FOUND' });

    const camonA = await repo.createDevice({ brand: 'Tecno', model: 'Camon 30', modelAliases: ['camon 30'] });
    const camonB = await repo.createDevice({ brand: 'Tecno', model: 'Camon 30 5G', modelAliases: ['camon 30'] });
    deviceIds.push(camonA.id, camonB.id);
    const amb = await repo.resolveDeviceQuery('Camon 30');
    expect(amb.kind).toBe('AMBIGUOUS');
  });

  it('AC1: compatible products come back in one query, ordered by fit_type', async () => {
    const device = await repo.createDevice({ brand: 'Samsung', model: 'Galaxy A15' });
    deviceIds.push(device.id);
    await mkProduct('exact');
    await mkProduct('universal');
    await mkProduct('adapter');
    await mkProduct('inactive', { active: false });
    await mkProduct('unapproved', { approval: 'draft' });
    await linkCompat('adapter', device.id, 'adapter_required');
    await linkCompat('universal', device.id, 'universal');
    await linkCompat('exact', device.id, 'exact');
    await linkCompat('inactive', device.id, 'exact');
    await linkCompat('unapproved', device.id, 'exact');

    const compatible = await repo.compatibleProducts(device.id);
    // Ordered exact -> universal -> adapter_required; inactive & unapproved excluded.
    expect(compatible.map((c) => c.fitType)).toEqual(['exact', 'universal', 'adapter_required']);
    expect(compatible.map((c) => c.productId)).toEqual([productIds.exact, productIds.universal, productIds.adapter]);
  });

  it('AC3: accessory suggestions cap at 3 and exclude cart / inactive / out-of-stock', async () => {
    const device = await repo.createDevice({ brand: 'Xiaomi', model: 'Redmi 13C' });
    deviceIds.push(device.id);
    await mkProduct('s1');
    await mkProduct('s2');
    await mkProduct('s3');
    await mkProduct('s4');
    await mkProduct('incart');
    await mkProduct('oos', { stock: 'out_of_stock' });
    for (const k of ['s1', 's2', 's3', 's4', 'incart', 'oos']) await linkCompat(k, device.id, 'exact');

    const suggestions = await repo.accessorySuggestions(device.id, [productIds.incart], 3);
    expect(suggestions.length).toBe(3); // capped
    const ids = suggestions.map((s) => s.productId);
    expect(ids).not.toContain(productIds.incart); // excluded (in cart)
    expect(ids).not.toContain(productIds.oos); // excluded (out of stock)
  });

  it('AC5: bulk import validates the whole file and resolves refs before committing', async () => {
    const device = await repo.createDevice({ brand: 'Infinix', model: 'Hot 40' });
    deviceIds.push(device.id);
    await mkProduct('imp1');
    await mkProduct('imp2');

    // One row references a non-existent product: NOTHING commits.
    const bad = await repo.importCompatibility(
      [
        { productRef: skus.imp1, deviceRef: device.slug, fitType: 'exact', confidence: 'declared' },
        { productRef: 'NO-SUCH-SKU', deviceRef: device.slug, fitType: 'exact', confidence: 'declared' },
      ],
      { actorId: '00000000-0000-4000-8000-000000000000' },
    );
    expect(bad.committed).toBe(0);
    expect(bad.errors).toContainEqual(expect.objectContaining({ row: 2, column: 'productRef' }));
    expect((await repo.compatibleProducts(device.id)).length).toBe(0); // truly nothing committed

    // A fully-valid file commits atomically.
    const ok = await repo.importCompatibility(
      [
        { productRef: skus.imp1, deviceRef: device.slug, fitType: 'exact', confidence: 'declared' },
        { productRef: skus.imp2, deviceRef: device.slug, fitType: 'universal', confidence: 'declared' },
      ],
      { actorId: '00000000-0000-4000-8000-000000000000' },
    );
    expect(ok.committed).toBe(2);
    expect(ok.errors).toHaveLength(0);
    expect((await repo.compatibleProducts(device.id)).length).toBe(2);

    // Verified rows without an evidence source are rejected up front (AC5 + schema).
    const verifiedNoEvidence = await repo.importCompatibility(
      [{ productRef: skus.imp1, deviceRef: device.slug, fitType: 'exact', confidence: 'verified' }],
      { actorId: '00000000-0000-4000-8000-000000000000' },
    );
    expect(verifiedNoEvidence.committed).toBe(0);
    expect(verifiedNoEvidence.errors).toContainEqual(expect.objectContaining({ column: 'evidenceSource' }));
  });
});
