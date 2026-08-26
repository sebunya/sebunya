import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '../client';
import { deviceBrands, deviceSeries, devices, productDeviceCompatibility } from '../schema/devices';
import { batteryRequests } from '../schema/batteries';
import { mediaAssets } from '../schema/media';
import type {
  BrandInput,
  DeviceBrandRecord,
  DeviceInput,
  DeviceListFilters,
  DeviceRecord,
  DeviceSeriesRecord,
  IDeviceCatalogueRepository,
  SeriesInput,
} from '../../../application/ports/IDeviceCatalogueRepository';
import { deviceLabel } from '../../../domain/batteries/DeviceHierarchy';

const VERIFIED = sql`c.workflow_status = 'ACTIVE' AND c.evidence_status IN ('PACKAGE_VERIFIED','FIT_TESTED','VERIFIED_EXACT','CONDITIONAL')`;

const brandSelection = {
  b: deviceBrands,
  logoUrl: mediaAssets.url,
  deviceCount: sql<number>`(SELECT count(*) FROM devices d WHERE d.brand_id = ${deviceBrands.id} AND d.status = 'ACTIVE')::int`,
  verifiedFits: sql<number>`(SELECT count(*) FROM product_device_compatibility c JOIN devices d ON d.id = c.device_id WHERE d.brand_id = ${deviceBrands.id} AND ${VERIFIED})::int`,
  demandCount: sql<number>`(SELECT count(*) FROM battery_finder_events e WHERE e.brand_id = ${deviceBrands.id} AND e.occurred_at > now() - interval '90 days')::int`,
};

function brandRecord(r: { b: typeof deviceBrands.$inferSelect; logoUrl: string | null; deviceCount: number; verifiedFits: number; demandCount: number }): DeviceBrandRecord {
  return { ...r.b, status: r.b.status as 'ACTIVE' | 'ARCHIVED', logoUrl: r.logoUrl, deviceCount: r.deviceCount, verifiedFits: r.verifiedFits, demandCount: r.demandCount };
}

const seriesSelection = {
  s: deviceSeries,
  deviceCount: sql<number>`(SELECT count(*) FROM devices d WHERE d.series_id = ${deviceSeries.id} AND d.status = 'ACTIVE')::int`,
  verifiedFits: sql<number>`(SELECT count(*) FROM product_device_compatibility c JOIN devices d ON d.id = c.device_id WHERE d.series_id = ${deviceSeries.id} AND ${VERIFIED})::int`,
  demandCount: sql<number>`(SELECT count(*) FROM battery_finder_events e JOIN devices d ON d.id = e.device_id WHERE d.series_id = ${deviceSeries.id} AND e.occurred_at > now() - interval '90 days')::int`,
};

function seriesRecord(r: { s: typeof deviceSeries.$inferSelect; deviceCount: number; verifiedFits: number; demandCount: number }): DeviceSeriesRecord {
  return { id: r.s.id, brandId: r.s.brandId, name: r.s.name, slug: r.s.slug, searchAliases: r.s.searchAliases, displayOrder: r.s.displayOrder, status: r.s.status as 'ACTIVE' | 'ARCHIVED', deviceCount: r.deviceCount, verifiedFits: r.verifiedFits, demandCount: r.demandCount };
}

const deviceSelection = {
  d: devices,
  seriesName: deviceSeries.name,
  claimCount: sql<number>`(SELECT count(*) FROM product_device_compatibility c WHERE c.device_id = ${devices.id} AND c.workflow_status <> 'ARCHIVED')::int`,
  verifiedFits: sql<number>`(SELECT count(*) FROM product_device_compatibility c WHERE c.device_id = ${devices.id} AND ${VERIFIED})::int`,
  demandCount: sql<number>`(SELECT count(*) FROM battery_finder_events e WHERE e.device_id = ${devices.id} AND e.occurred_at > now() - interval '90 days')::int`,
};

function deviceRecord(r: { d: typeof devices.$inferSelect; seriesName: string | null; claimCount: number; verifiedFits: number; demandCount: number }): DeviceRecord {
  const d = r.d;
  return {
    id: d.id,
    brandId: d.brandId,
    brandName: d.brand,
    seriesId: d.seriesId,
    seriesName: r.seriesName,
    model: d.model,
    modelNumber: d.modelNumber,
    variant: d.variant,
    slug: d.slug,
    modelAliases: d.modelAliases,
    releaseYear: d.releaseYear,
    status: d.status as DeviceRecord['status'],
    displayOrder: d.displayOrder,
    mergedIntoDeviceId: d.mergedIntoDeviceId,
    sourceReference: d.sourceReference,
    claimCount: r.claimCount,
    verifiedFits: r.verifiedFits,
    demandCount: r.demandCount,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

export class DrizzleDeviceCatalogueRepository implements IDeviceCatalogueRepository {
  // ---------------------------------------------------------------- brands
  async listBrands(includeArchived: boolean) {
    const rows = await db.select(brandSelection).from(deviceBrands).leftJoin(mediaAssets, eq(mediaAssets.id, deviceBrands.logoAssetId))
      .where(includeArchived ? undefined : eq(deviceBrands.status, 'ACTIVE'))
      .orderBy(desc(deviceBrands.isFeatured), asc(deviceBrands.displayOrder), asc(deviceBrands.name));
    return rows.map(brandRecord);
  }

  private async brandWhere(where: ReturnType<typeof eq>) {
    const [row] = await db.select(brandSelection).from(deviceBrands).leftJoin(mediaAssets, eq(mediaAssets.id, deviceBrands.logoAssetId)).where(where).limit(1);
    return row ? brandRecord(row) : null;
  }

  findBrand(id: string) { return this.brandWhere(eq(deviceBrands.id, id)); }
  findBrandBySlug(slug: string) { return this.brandWhere(eq(deviceBrands.slug, slug)); }
  findBrandByNormalised(nameNormalised: string) { return this.brandWhere(eq(deviceBrands.nameNormalised, nameNormalised)); }

  async createBrand(input: BrandInput) {
    const [row] = await db.insert(deviceBrands).values({
      name: input.name, nameNormalised: input.nameNormalised, slug: input.slug, searchAliases: input.searchAliases, searchAliasesNormalised: input.searchAliasesNormalised,
      isFeatured: input.isFeatured, displayOrder: input.displayOrder, logoAssetId: input.logoAssetId, createdBy: input.actorId, updatedBy: input.actorId,
    }).returning({ id: deviceBrands.id });
    return (await this.findBrand(row.id))!;
  }

  async updateBrand(id: string, patch: Partial<BrandInput>) {
    const { actorId, ...rest } = patch;
    const set: Record<string, unknown> = { ...rest, updatedAt: new Date() };
    if (actorId) set.updatedBy = actorId;
    await db.update(deviceBrands).set(set as never).where(eq(deviceBrands.id, id));
    if (patch.name) await db.update(devices).set({ brand: patch.name, brandNormalised: patch.nameNormalised ?? undefined, updatedAt: new Date() }).where(eq(devices.brandId, id));
    return this.findBrand(id);
  }

  async setBrandStatus(id: string, status: 'ACTIVE' | 'ARCHIVED', actorId: string) {
    await db.update(deviceBrands).set({ status, updatedBy: actorId, updatedAt: new Date() }).where(eq(deviceBrands.id, id));
    return this.findBrand(id);
  }

  async reorderBrands(orderedIds: string[], actorId: string) {
    await db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.update(deviceBrands).set({ displayOrder: i + 1, updatedBy: actorId, updatedAt: new Date() }).where(eq(deviceBrands.id, orderedIds[i]));
      }
    });
  }

  // ---------------------------------------------------------------- series
  async listSeries(brandId: string, includeArchived: boolean) {
    const rows = await db.select(seriesSelection).from(deviceSeries)
      .where(includeArchived ? eq(deviceSeries.brandId, brandId) : and(eq(deviceSeries.brandId, brandId), eq(deviceSeries.status, 'ACTIVE')))
      .orderBy(asc(deviceSeries.displayOrder), asc(deviceSeries.name));
    return rows.map(seriesRecord);
  }

  private async seriesWhere(where: ReturnType<typeof eq>) {
    const [row] = await db.select(seriesSelection).from(deviceSeries).where(where).limit(1);
    return row ? seriesRecord(row) : null;
  }

  findSeries(id: string) { return this.seriesWhere(eq(deviceSeries.id, id)); }

  async findSeriesByNormalised(brandId: string, nameNormalised: string) {
    const [row] = await db.select(seriesSelection).from(deviceSeries).where(and(eq(deviceSeries.brandId, brandId), eq(deviceSeries.nameNormalised, nameNormalised))).limit(1);
    return row ? seriesRecord(row) : null;
  }

  async createSeries(input: SeriesInput) {
    const [row] = await db.insert(deviceSeries).values({
      brandId: input.brandId, name: input.name, nameNormalised: input.nameNormalised, slug: input.slug, searchAliases: input.searchAliases,
      searchAliasesNormalised: input.searchAliasesNormalised, displayOrder: input.displayOrder, createdBy: input.actorId, updatedBy: input.actorId,
    }).returning({ id: deviceSeries.id });
    return (await this.findSeries(row.id))!;
  }

  async updateSeries(id: string, patch: Partial<SeriesInput>) {
    const { actorId, brandId: _b, ...rest } = patch;
    const set: Record<string, unknown> = { ...rest, updatedAt: new Date() };
    if (actorId) set.updatedBy = actorId;
    await db.update(deviceSeries).set(set as never).where(eq(deviceSeries.id, id));
    return this.findSeries(id);
  }

  async setSeriesStatus(id: string, status: 'ACTIVE' | 'ARCHIVED', actorId: string) {
    await db.update(deviceSeries).set({ status, updatedBy: actorId, updatedAt: new Date() }).where(eq(deviceSeries.id, id));
    return this.findSeries(id);
  }

  async reorderSeries(brandId: string, orderedIds: string[], actorId: string) {
    await db.transaction(async (tx) => {
      for (let i = 0; i < orderedIds.length; i++) {
        await tx.update(deviceSeries).set({ displayOrder: i + 1, updatedBy: actorId, updatedAt: new Date() }).where(and(eq(deviceSeries.id, orderedIds[i]), eq(deviceSeries.brandId, brandId)));
      }
    });
  }

  // --------------------------------------------------------------- devices
  async listDevices(filters: DeviceListFilters) {
    const conditions = [];
    if (filters.brandId) conditions.push(eq(devices.brandId, filters.brandId));
    if (filters.seriesId) conditions.push(eq(devices.seriesId, filters.seriesId));
    if (filters.status && filters.status !== 'ALL') conditions.push(eq(devices.status, filters.status));
    else if (!filters.status) conditions.push(eq(devices.status, 'ACTIVE'));
    if (filters.q && filters.q.trim()) {
      const needle = `%${filters.q.trim()}%`;
      conditions.push(or(ilike(devices.model, needle), ilike(devices.modelNumber, needle), ilike(devices.brand, needle), ilike(devices.variant, needle), sql`EXISTS (SELECT 1 FROM unnest(${devices.modelAliases}) a WHERE a ILIKE ${needle})`)!);
    }
    const rows = await db.select(deviceSelection).from(devices).leftJoin(deviceSeries, eq(deviceSeries.id, devices.seriesId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(asc(devices.brand), asc(devices.model), asc(devices.modelNumber))
      .limit(filters.limit ?? 200);
    return rows.map(deviceRecord);
  }

  private async deviceWhere(where: ReturnType<typeof eq> | ReturnType<typeof and>) {
    const [row] = await db.select(deviceSelection).from(devices).leftJoin(deviceSeries, eq(deviceSeries.id, devices.seriesId)).where(where).limit(1);
    return row ? deviceRecord(row) : null;
  }

  findDevice(id: string) { return this.deviceWhere(eq(devices.id, id)); }
  findDeviceBySlug(slug: string) { return this.deviceWhere(eq(devices.slug, slug)); }

  findDeviceByIdentity(identity: { brandNormalised: string; modelNormalised: string; modelNumberNormalised: string | null; variantNormalised: string | null }) {
    return this.deviceWhere(and(
      eq(devices.brandNormalised, identity.brandNormalised),
      eq(devices.modelNormalised, identity.modelNormalised),
      sql`COALESCE(${devices.modelNumberNormalised}, '') = ${identity.modelNumberNormalised ?? ''}`,
      sql`COALESCE(${devices.variantNormalised}, '') = ${identity.variantNormalised ?? ''}`,
    ));
  }

  async createDevice(input: DeviceInput) {
    const [row] = await db.insert(devices).values({
      brand: input.brandName,
      model: input.model,
      brandNormalised: input.brandNormalised,
      modelNormalised: input.modelNormalised,
      modelAliases: input.modelAliases,
      modelAliasesNormalised: input.modelAliasesNormalised,
      slug: input.slug,
      releaseYear: input.releaseYear,
      brandId: input.brandId,
      seriesId: input.seriesId,
      modelNumber: input.modelNumber,
      modelNumberNormalised: input.modelNumberNormalised,
      variant: input.variant,
      variantNormalised: input.variantNormalised,
      status: 'ACTIVE',
      isActive: true,
      displayOrder: input.displayOrder,
      sourceReference: input.sourceReference,
      createdBy: input.actorId,
      updatedBy: input.actorId,
    }).returning({ id: devices.id });
    return (await this.findDevice(row.id))!;
  }

  async updateDevice(id: string, patch: Partial<DeviceInput>) {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.brandName !== undefined) set.brand = patch.brandName;
    if (patch.brandNormalised !== undefined) set.brandNormalised = patch.brandNormalised;
    for (const key of ['brandId', 'seriesId', 'model', 'modelNormalised', 'modelNumber', 'modelNumberNormalised', 'variant', 'variantNormalised', 'modelAliases', 'modelAliasesNormalised', 'releaseYear', 'displayOrder', 'sourceReference'] as const) {
      if (patch[key] !== undefined) set[key] = patch[key];
    }
    if (patch.actorId) set.updatedBy = patch.actorId;
    await db.update(devices).set(set as never).where(eq(devices.id, id));
    return this.findDevice(id);
  }

  async setDeviceStatus(id: string, status: 'ACTIVE' | 'ARCHIVED', actorId: string) {
    await db.update(devices).set({ status, isActive: status === 'ACTIVE', archivedAt: status === 'ARCHIVED' ? new Date() : null, updatedBy: actorId, updatedAt: new Date() }).where(eq(devices.id, id));
    return this.findDevice(id);
  }

  async deviceMappingProducts(deviceId: string) {
    const rows = await db.select({ productId: productDeviceCompatibility.productId }).from(productDeviceCompatibility).where(eq(productDeviceCompatibility.deviceId, deviceId));
    return rows.map((r) => r.productId);
  }

  async openRequestsForDevice(deviceId: string) {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(batteryRequests).where(and(eq(batteryRequests.resolvedDeviceId, deviceId), eq(batteryRequests.status, 'OPEN')));
    return row?.n ?? 0;
  }

  async merge(sourceId: string, targetId: string, actorId: string, carryAliases: string[]) {
    return db.transaction(async (tx) => {
      const [source] = await tx.select().from(devices).where(eq(devices.id, sourceId)).for('update');
      const [target] = await tx.select().from(devices).where(eq(devices.id, targetId)).for('update');
      if (!source || !target) throw new Error('Device not found.');
      const sourceRows = await tx.select().from(productDeviceCompatibility).where(eq(productDeviceCompatibility.deviceId, sourceId));
      const targetProducts = new Set((await tx.select({ productId: productDeviceCompatibility.productId }).from(productDeviceCompatibility).where(eq(productDeviceCompatibility.deviceId, targetId))).map((r) => r.productId));
      let moved = 0;
      let archivedDuplicates = 0;
      for (const row of sourceRows) {
        if (targetProducts.has(row.productId)) {
          // Keep the target's copy; the source copy is archived, not deleted, so history stays.
          await tx.update(productDeviceCompatibility).set({ workflowStatus: 'ARCHIVED', archivedAt: new Date(), notes: `${row.notes ? `${row.notes}\n` : ''}Archived on merge into ${target.slug}`, updatedAt: new Date() }).where(eq(productDeviceCompatibility.id, row.id));
          archivedDuplicates += 1;
        } else {
          await tx.update(productDeviceCompatibility).set({ deviceId: targetId, updatedAt: new Date(), notes: `${row.notes ? `${row.notes}\n` : ''}Moved from ${source.slug} on merge` }).where(eq(productDeviceCompatibility.id, row.id));
          moved += 1;
        }
      }
      const aliases = Array.from(new Set([...target.modelAliases, ...carryAliases])).filter((a) => a && a.toLowerCase() !== target.model.toLowerCase());
      const normalised = Array.from(new Set(aliases.map((a) => a.normalize('NFKD').toLowerCase().replace(/\+/g, ' plus ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ')).filter(Boolean)));
      await tx.update(devices).set({ modelAliases: aliases, modelAliasesNormalised: normalised, updatedBy: actorId, updatedAt: new Date() }).where(eq(devices.id, targetId));
      await tx.update(devices).set({ status: 'MERGED', isActive: false, mergedIntoDeviceId: targetId, archivedAt: new Date(), updatedBy: actorId, updatedAt: new Date() }).where(eq(devices.id, sourceId));
      await tx.update(batteryRequests).set({ resolvedDeviceId: targetId }).where(eq(batteryRequests.resolvedDeviceId, sourceId));
      await tx.execute(sql`UPDATE battery_finder_events SET device_id = ${targetId} WHERE device_id = ${sourceId}`);
      return { moved, archivedDuplicates };
    });
  }
}

export { deviceLabel };
