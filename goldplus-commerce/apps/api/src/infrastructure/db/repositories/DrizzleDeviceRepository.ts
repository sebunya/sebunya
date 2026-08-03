import { and, desc, eq, notInArray, sql } from 'drizzle-orm';
import { db } from '../client';
import { devices, productDeviceCompatibility } from '../schema/devices';
import { products } from '../schema/products';
import {
  CompatibilityImportOutcome,
  CompatibleProduct,
  CreateDeviceInput,
  IDeviceRepository,
} from '../../../application/ports/IDeviceRepository';
import { deviceSlug, normaliseAliases, normaliseDeviceToken, resolveDeviceQuery, DeviceAliasCandidate } from '../../../domain/products/Devices';
import { ImportRowError, RawCompatibilityRow, validateCompatibilityImport } from '../../../domain/products/DeviceCompatibilityImport';

// fit_type ordering: exact first, then universal, then adapter_required.
const FIT_RANK = sql`CASE ${productDeviceCompatibility.fitType} WHEN 'exact' THEN 0 WHEN 'universal' THEN 1 ELSE 2 END`;
// Popularity signal = real units sold; avoids inventing a metric.
const SOLD = sql`(SELECT count(*) FROM order_items oi WHERE oi.product_id = ${products.id})`;

export class DrizzleDeviceRepository implements IDeviceRepository {
  async createDevice(input: CreateDeviceInput): Promise<{ id: string; slug: string }> {
    const aliases = input.modelAliases ?? [];
    const slug = deviceSlug(input.brand, input.model);
    const [row] = await db
      .insert(devices)
      .values({
        brand: input.brand.trim(),
        model: input.model.trim(),
        brandNormalised: normaliseDeviceToken(input.brand),
        modelNormalised: normaliseDeviceToken(input.model),
        modelAliases: aliases,
        modelAliasesNormalised: normaliseAliases(aliases),
        slug,
        releaseYear: input.releaseYear ?? null,
        connectorType: input.connectorType ?? null,
        chargingWattageMax: input.chargingWattageMax ?? null,
        popularityRankUg: input.popularityRankUg ?? null,
      })
      .returning({ id: devices.id, slug: devices.slug });
    return row;
  }

  /** Admin overview: recent devices with a compatibility count. */
  async adminList(limit = 100): Promise<Array<{ id: string; brand: string; model: string; slug: string; isActive: boolean; compatibleCount: number }>> {
    const rows = await db
      .select({
        id: devices.id, brand: devices.brand, model: devices.model, slug: devices.slug, isActive: devices.isActive,
        compatibleCount: sql<number>`(SELECT count(*) FROM product_device_compatibility c WHERE c.device_id = ${devices.id})::int`,
      })
      .from(devices)
      .orderBy(desc(devices.createdAt))
      .limit(Math.min(limit, 500));
    return rows;
  }

  async resolveDeviceQuery(query: string) {
    const rows = await db
      .select({ id: devices.id, brandNormalised: devices.brandNormalised, modelNormalised: devices.modelNormalised, aliasesNormalised: devices.modelAliasesNormalised, isActive: devices.isActive })
      .from(devices)
      .where(eq(devices.isActive, true));
    const candidates: DeviceAliasCandidate[] = rows.map((r) => ({ id: r.id, brandNormalised: r.brandNormalised, modelNormalised: r.modelNormalised, aliasesNormalised: r.aliasesNormalised, isActive: r.isActive }));
    return resolveDeviceQuery(query, candidates);
  }

  async compatibleProducts(deviceId: string): Promise<CompatibleProduct[]> {
    const rows = await db
      .select({ productId: products.id, sku: products.sku, name: products.name, fitType: productDeviceCompatibility.fitType, confidence: productDeviceCompatibility.confidence })
      .from(productDeviceCompatibility)
      .innerJoin(products, eq(products.id, productDeviceCompatibility.productId))
      .where(and(eq(productDeviceCompatibility.deviceId, deviceId), eq(products.active, true), eq(products.approvalStatus, 'approved')))
      .orderBy(FIT_RANK, sql`${SOLD} DESC`, products.name);
    return rows as CompatibleProduct[];
  }

  async accessorySuggestions(deviceId: string, excludeProductIds: string[], limit: number): Promise<CompatibleProduct[]> {
    const exclude = excludeProductIds.length ? excludeProductIds : ['00000000-0000-0000-0000-000000000000'];
    const rows = await db
      .select({ productId: products.id, sku: products.sku, name: products.name, fitType: productDeviceCompatibility.fitType, confidence: productDeviceCompatibility.confidence })
      .from(productDeviceCompatibility)
      .innerJoin(products, eq(products.id, productDeviceCompatibility.productId))
      .where(
        and(
          eq(productDeviceCompatibility.deviceId, deviceId),
          eq(products.active, true),
          eq(products.approvalStatus, 'approved'),
          eq(products.stockStatus, 'in_stock'),
          notInArray(products.id, exclude),
        ),
      )
      .orderBy(FIT_RANK, sql`${SOLD} DESC`, products.name)
      .limit(Math.max(1, Math.min(limit, 3)));
    return rows as CompatibleProduct[];
  }

  async importCompatibility(raw: RawCompatibilityRow[], ctx: { actorId: string; fileByteLength?: number }): Promise<CompatibilityImportOutcome> {
    // 1. Shape/enum/bounds validation for the WHOLE file first.
    const validation = validateCompatibilityImport(raw, ctx.fileByteLength);
    if (!validation.ok) return { committed: 0, errors: validation.errors };

    // 2. Resolve every reference before committing anything. Unresolved refs are
    //    per-row errors — still nothing is committed.
    const errors: ImportRowError[] = [];
    const resolved: Array<{ productId: string; deviceId: string; fitType: string; confidence: string; evidenceSource: string | null; notes: string | null }> = [];
    for (let i = 0; i < validation.rows.length; i++) {
      const row = validation.rows[i];
      const rowNum = i + 1;
      const [product] = await db
        .select({ id: products.id })
        .from(products)
        .where(sql`${products.sku} = ${row.productRef} OR ${products.id}::text = ${row.productRef}`)
        .limit(1);
      if (!product) { errors.push({ row: rowNum, column: 'productRef', message: `No product for "${row.productRef}".` }); continue; }
      const [device] = await db.select({ id: devices.id }).from(devices).where(eq(devices.slug, row.deviceRef)).limit(1);
      if (!device) { errors.push({ row: rowNum, column: 'deviceRef', message: `No device for slug "${row.deviceRef}".` }); continue; }
      resolved.push({
        productId: product.id,
        deviceId: device.id,
        fitType: row.fitType,
        confidence: row.confidence,
        evidenceSource: row.evidenceSource,
        notes: row.notes,
      });
    }
    if (errors.length) return { committed: 0, errors };

    // 3. Commit all canonical rows in ONE transaction. Verified rows carry the
    //    importing actor + timestamp as their evidence.
    const now = new Date();
    await db.transaction(async (tx) => {
      for (const r of resolved) {
        await tx
          .insert(productDeviceCompatibility)
          .values({
            productId: r.productId,
            deviceId: r.deviceId,
            fitType: r.fitType,
            confidence: r.confidence,
            verifiedBy: r.confidence === 'verified' ? ctx.actorId : null,
            verifiedAt: r.confidence === 'verified' ? now : null,
            evidenceSource: r.evidenceSource,
            notes: r.notes,
          })
          .onConflictDoUpdate({
            target: [productDeviceCompatibility.productId, productDeviceCompatibility.deviceId],
            set: { fitType: r.fitType, confidence: r.confidence, evidenceSource: r.evidenceSource, notes: r.notes },
          });
      }
    });
    return { committed: resolved.length, errors: [] };
  }
}
