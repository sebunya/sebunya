import { and, desc, eq, sql } from 'drizzle-orm';
import { client, db } from '../client';
import { products } from '../schema/products';
import { deviceBrands, deviceSeries, devices, productDeviceCompatibility } from '../schema/devices';
import { batteryAliases, batteryFinderConfig, batteryFinderEvents, batteryProfiles, batteryRequests } from '../schema/batteries';
import type { BatteryFinderConfig, BatteryRequestStatus, FinderBrandDto, FinderDeviceDto, FinderSeriesDto } from '@goldplus/shared';
import type { BatteryRequestRecord, DemandOverview, FinderEventWrite, IBatteryFinderRepository, PublicFitRow } from '../../../application/ports/IBatteryFinderRepository';
import type { BatteryCandidate, DeviceCandidate } from '../../../domain/batteries/FinderRanking';
import { deviceLabel } from '../../../domain/batteries/DeviceHierarchy';

const jsonb = (value: unknown) => sql`${client.json(value as never)}::jsonb`;

/** A public fit: live workflow, non-rejected evidence. The use case derives the customer-facing state. */
const PUBLIC_CLAIM = sql`${productDeviceCompatibility.workflowStatus} = 'ACTIVE' AND ${productDeviceCompatibility.evidenceStatus} <> 'REJECTED'`;
const VERIFIED_PUBLIC = sql`c.workflow_status = 'ACTIVE' AND c.evidence_status IN ('PACKAGE_VERIFIED','FIT_TESTED','VERIFIED_EXACT','CONDITIONAL') AND bp.lifecycle_status = 'ACTIVE' AND p.approval_status = 'approved' AND p.active`;

const PRIMARY_IMAGE = sql<string | null>`COALESCE(${products.imageUrl}, (SELECT i.url FROM product_images i WHERE i.product_id = ${products.id} ORDER BY i.is_primary DESC, i.display_order ASC LIMIT 1))`;

function deviceDto(d: typeof devices.$inferSelect, seriesName: string | null, verifiedFits: number): FinderDeviceDto {
  return {
    id: d.id,
    slug: d.slug,
    brandName: d.brand,
    seriesName,
    model: d.model,
    modelNumber: d.modelNumber,
    variant: d.variant,
    label: deviceLabel({ brandName: d.brand, model: d.model, modelNumber: d.modelNumber, variant: d.variant }),
    releaseYear: d.releaseYear,
    verifiedFits,
  };
}

const publicProduct = {
  productId: products.id,
  slug: products.slug,
  name: products.name,
  canonicalCode: batteryProfiles.canonicalCode,
  imageUrl: PRIMARY_IMAGE,
  priceUgx: sql<number | null>`CASE WHEN ${products.priceUgx} > 0 THEN ${products.priceUgx} ELSE NULL END`,
  capacityMah: batteryProfiles.capacityMah,
  nominalVoltageMv: batteryProfiles.nominalVoltageMv,
};

export class DrizzleBatteryFinderRepository implements IBatteryFinderRepository {
  // ---------------------------------------------------------------- config
  async getConfig() {
    const [row] = await db.select().from(batteryFinderConfig).where(eq(batteryFinderConfig.id, true)).limit(1);
    return row ? { config: row.config as BatteryFinderConfig, version: row.version } : null;
  }

  async seedConfig(config: BatteryFinderConfig) {
    const inserted = await db.insert(batteryFinderConfig).values({ id: true, config: jsonb(config) as never }).onConflictDoNothing({ target: batteryFinderConfig.id }).returning({ id: batteryFinderConfig.id });
    return { inserted: inserted.length > 0 };
  }

  async saveConfig(config: BatteryFinderConfig, expectedVersion: number, actorId: string) {
    const [row] = await db.update(batteryFinderConfig)
      .set({ config: jsonb(config) as never, version: sql`${batteryFinderConfig.version} + 1`, updatedBy: actorId, updatedAt: new Date() })
      .where(and(eq(batteryFinderConfig.id, true), eq(batteryFinderConfig.version, expectedVersion)))
      .returning({ version: batteryFinderConfig.version });
    return row ?? null;
  }

  // ---------------------------------------------------------------- browse
  async brands(showAwaiting: boolean): Promise<FinderBrandDto[]> {
    const awaiting = showAwaiting ? sql`OR (c.workflow_status = 'ACTIVE' AND c.evidence_status = 'SUPPLIER_LISTED' AND bp.lifecycle_status = 'ACTIVE' AND p.approval_status = 'approved' AND p.active)` : sql``;
    const rows = (await db.execute(sql`
      SELECT b.id, b.name, b.slug, b.is_featured AS "isFeatured",
        (SELECT count(*) FROM devices d WHERE d.brand_id = b.id AND d.status = 'ACTIVE')::int AS "deviceCount",
        (SELECT count(*) FROM product_device_compatibility c JOIN devices d ON d.id = c.device_id JOIN battery_profiles bp ON bp.product_id = c.product_id JOIN products p ON p.id = c.product_id
           WHERE d.brand_id = b.id AND d.status = 'ACTIVE' AND (${VERIFIED_PUBLIC} ${awaiting}))::int AS "verifiedFits"
      FROM device_brands b WHERE b.status = 'ACTIVE'
      ORDER BY b.is_featured DESC, b.display_order ASC, b.name ASC`)) as unknown as FinderBrandDto[];
    return rows;
  }

  async brandBySlug(slug: string, showAwaiting: boolean) {
    const brands = await this.brands(showAwaiting);
    const brand = brands.find((b) => b.slug === slug);
    if (!brand) return null;
    const seriesRows = await db.select({ s: deviceSeries, deviceCount: sql<number>`(SELECT count(*) FROM devices d WHERE d.series_id = ${deviceSeries.id} AND d.status = 'ACTIVE')::int` })
      .from(deviceSeries).where(and(eq(deviceSeries.brandId, brand.id), eq(deviceSeries.status, 'ACTIVE'))).orderBy(deviceSeries.displayOrder, deviceSeries.name);
    const series: FinderSeriesDto[] = seriesRows.map((r) => ({ id: r.s.id, name: r.s.name, slug: r.s.slug, deviceCount: r.deviceCount }));
    const deviceRows = await db.select({
      d: devices,
      seriesName: deviceSeries.name,
      verifiedFits: sql<number>`(SELECT count(*) FROM product_device_compatibility c JOIN battery_profiles bp ON bp.product_id = c.product_id JOIN products p ON p.id = c.product_id WHERE c.device_id = ${devices.id} AND ${VERIFIED_PUBLIC})::int`,
      demandCount: sql<number>`(SELECT count(*) FROM battery_finder_events e WHERE e.device_id = ${devices.id} AND e.occurred_at > now() - interval '90 days')::int`,
    }).from(devices).leftJoin(deviceSeries, eq(deviceSeries.id, devices.seriesId)).where(and(eq(devices.brandId, brand.id), eq(devices.status, 'ACTIVE'))).orderBy(devices.model, devices.modelNumber);
    return {
      brand,
      series,
      devices: deviceRows.map((r) => ({ ...deviceDto(r.d, r.seriesName, r.verifiedFits), seriesId: r.d.seriesId, displayOrder: r.d.displayOrder, demandCount: r.demandCount })),
    };
  }

  private async deviceWhere(where: ReturnType<typeof eq>): Promise<FinderDeviceDto | null> {
    const [row] = await db.select({
      d: devices,
      seriesName: deviceSeries.name,
      verifiedFits: sql<number>`(SELECT count(*) FROM product_device_compatibility c JOIN battery_profiles bp ON bp.product_id = c.product_id JOIN products p ON p.id = c.product_id WHERE c.device_id = ${devices.id} AND ${VERIFIED_PUBLIC})::int`,
    }).from(devices).leftJoin(deviceSeries, eq(deviceSeries.id, devices.seriesId)).where(where).limit(1);
    if (!row) return null;
    // A merged device answers as its target so old links keep working.
    if (row.d.status === 'MERGED' && row.d.mergedIntoDeviceId) return this.deviceById(row.d.mergedIntoDeviceId);
    if (row.d.status !== 'ACTIVE') return null;
    return deviceDto(row.d, row.seriesName, row.verifiedFits);
  }

  deviceBySlug(slug: string): Promise<FinderDeviceDto | null> { return this.deviceWhere(eq(devices.slug, slug)); }
  deviceById(id: string): Promise<FinderDeviceDto | null> { return this.deviceWhere(eq(devices.id, id)); }

  private fitSelection() {
    return db.select({
      claimId: productDeviceCompatibility.id,
      productId: productDeviceCompatibility.productId,
      deviceId: productDeviceCompatibility.deviceId,
      evidenceStatus: productDeviceCompatibility.evidenceStatus,
      workflowStatus: productDeviceCompatibility.workflowStatus,
      publicCondition: productDeviceCompatibility.publicCondition,
      batteryLifecycle: batteryProfiles.lifecycleStatus,
      approvalStatus: products.approvalStatus,
      active: products.active,
      stockQuantity: products.stockQuantity,
      product: publicProduct,
      d: devices,
      seriesName: deviceSeries.name,
    })
      .from(productDeviceCompatibility)
      .innerJoin(products, eq(products.id, productDeviceCompatibility.productId))
      .innerJoin(batteryProfiles, eq(batteryProfiles.productId, productDeviceCompatibility.productId))
      .innerJoin(devices, eq(devices.id, productDeviceCompatibility.deviceId))
      .leftJoin(deviceSeries, eq(deviceSeries.id, devices.seriesId));
  }

  private toFitRow(r: Awaited<ReturnType<ReturnType<DrizzleBatteryFinderRepository['fitSelection']>['execute']>>[number]): PublicFitRow {
    return {
      claimId: r.claimId,
      productId: r.productId,
      deviceId: r.deviceId,
      evidenceStatus: r.evidenceStatus,
      workflowStatus: r.workflowStatus,
      publicCondition: r.publicCondition,
      batteryLifecycle: r.batteryLifecycle,
      productApproved: r.approvalStatus === 'approved',
      productActive: r.active,
      stockQuantity: r.stockQuantity,
      product: { ...r.product, imageUrl: r.product.imageUrl ?? null, priceUgx: r.product.priceUgx == null ? null : Number(r.product.priceUgx) },
      device: deviceDto(r.d, r.seriesName, 0),
    };
  }

  async fitsForDevice(deviceId: string) {
    const rows = await this.fitSelection().where(and(eq(productDeviceCompatibility.deviceId, deviceId), PUBLIC_CLAIM, eq(devices.status, 'ACTIVE')));
    return rows.map((r) => this.toFitRow(r));
  }

  async fitsForBattery(productId: string) {
    const rows = await this.fitSelection().where(and(eq(productDeviceCompatibility.productId, productId), PUBLIC_CLAIM, eq(devices.status, 'ACTIVE')));
    return rows.map((r) => this.toFitRow(r));
  }

  async batteryPublic(productId: string) {
    const [row] = await db.select({ product: publicProduct, lifecycleStatus: batteryProfiles.lifecycleStatus, stockQuantity: products.stockQuantity, approvalStatus: products.approvalStatus, active: products.active })
      .from(batteryProfiles).innerJoin(products, eq(products.id, batteryProfiles.productId)).where(eq(batteryProfiles.productId, productId)).limit(1);
    if (!row) return null;
    return { ...row.product, imageUrl: row.product.imageUrl ?? null, priceUgx: row.product.priceUgx == null ? null : Number(row.product.priceUgx), lifecycleStatus: row.lifecycleStatus, stockQuantity: row.stockQuantity, productApproved: row.approvalStatus === 'approved', productActive: row.active };
  }

  async batteryPublicBySlug(slug: string) {
    const [row] = await db.select({ product: publicProduct, lifecycleStatus: batteryProfiles.lifecycleStatus, publicNotes: batteryProfiles.publicNotes, warrantyMonths: batteryProfiles.warrantyMonths, chemistry: batteryProfiles.chemistry })
      .from(batteryProfiles).innerJoin(products, eq(products.id, batteryProfiles.productId)).where(eq(products.slug, slug)).limit(1);
    if (!row) return null;
    return { ...row.product, imageUrl: row.product.imageUrl ?? null, priceUgx: row.product.priceUgx == null ? null : Number(row.product.priceUgx), lifecycleStatus: row.lifecycleStatus, publicNotes: row.publicNotes, warrantyMonths: row.warrantyMonths, chemistry: row.chemistry };
  }

  // ---------------------------------------------------------------- search
  async deviceCandidates(): Promise<DeviceCandidate[]> {
    const rows = await db.select({
      id: devices.id, brandNormalised: devices.brandNormalised, modelNormalised: devices.modelNormalised, modelNumberNormalised: devices.modelNumberNormalised,
      variantNormalised: devices.variantNormalised, aliasesNormalised: devices.modelAliasesNormalised, status: devices.status, brandAliasesNormalised: deviceBrands.searchAliasesNormalised,
    }).from(devices).leftJoin(deviceBrands, eq(deviceBrands.id, devices.brandId)).where(eq(devices.status, 'ACTIVE'));
    return rows.map((r) => ({ ...r, brandAliasesNormalised: r.brandAliasesNormalised ?? [] }));
  }

  async batteryCandidates(): Promise<BatteryCandidate[]> {
    const rows = await db.select({
      productId: batteryProfiles.productId,
      canonicalCodeNormalised: batteryProfiles.canonicalCodeNormalised,
      supplierCodeNormalised: sql<string | null>`NULLIF(upper(regexp_replace(coalesce(${batteryProfiles.supplierCode}, ''), '[^A-Za-z0-9]', '', 'g')), '')`,
      barcode: batteryProfiles.barcode,
      lifecycleStatus: batteryProfiles.lifecycleStatus,
      aliasesNormalised: sql<string[]>`COALESCE((SELECT array_agg(a.alias_normalised) FROM battery_aliases a WHERE a.battery_product_id = ${batteryProfiles.productId} AND a.is_active), '{}')`,
    }).from(batteryProfiles).where(sql`${batteryProfiles.lifecycleStatus} <> 'ARCHIVED'`);
    return rows;
  }

  async fuzzyDevices(query: string, limit: number) {
    const rows = (await db.execute(sql`
      SELECT d.id, GREATEST(similarity(d.model_normalised, ${query}), similarity(d.brand_normalised || ' ' || d.model_normalised, ${query}),
             COALESCE((SELECT max(similarity(a, ${query})) FROM unnest(d.model_aliases_normalised) a), 0)) AS score
      FROM devices d WHERE d.status = 'ACTIVE' AND (d.model_normalised % ${query} OR (d.brand_normalised || ' ' || d.model_normalised) % ${query})
      ORDER BY score DESC LIMIT ${Math.min(limit, 20)}`)) as unknown as Array<{ id: string; score: number }>;
    return rows.map((r) => ({ id: r.id, score: Number(r.score) }));
  }

  async fuzzyBatteries(queryNormalised: string, limit: number) {
    const rows = (await db.execute(sql`
      SELECT bp.product_id AS "productId", GREATEST(similarity(bp.canonical_code_normalised, ${queryNormalised}),
             COALESCE((SELECT max(similarity(a.alias_normalised, ${queryNormalised})) FROM battery_aliases a WHERE a.battery_product_id = bp.product_id AND a.is_active), 0)) AS score
      FROM battery_profiles bp WHERE bp.lifecycle_status = 'ACTIVE' AND (bp.canonical_code_normalised % ${queryNormalised}
        OR EXISTS (SELECT 1 FROM battery_aliases a WHERE a.battery_product_id = bp.product_id AND a.is_active AND a.alias_normalised % ${queryNormalised}))
      ORDER BY score DESC LIMIT ${Math.min(limit, 20)}`)) as unknown as Array<{ productId: string; score: number }>;
    return rows.map((r) => ({ productId: r.productId, score: Number(r.score) }));
  }

  async verifiedFitCount() {
    const [row] = (await db.execute(sql`SELECT count(*)::int AS n FROM product_device_compatibility c JOIN battery_profiles bp ON bp.product_id = c.product_id JOIN products p ON p.id = c.product_id JOIN devices d ON d.id = c.device_id WHERE d.status = 'ACTIVE' AND ${VERIFIED_PUBLIC}`)) as unknown as Array<{ n: number }>;
    return row?.n ?? 0;
  }

  // --------------------------------------------------------------- demand
  async recordEvent(event: FinderEventWrite) {
    await db.insert(batteryFinderEvents).values({ ...event });
  }

  async createRequest(input: Parameters<IBatteryFinderRepository['createRequest']>[0]): Promise<BatteryRequestRecord> {
    const [row] = await db.insert(batteryRequests).values({ ...input }).returning();
    return { ...row, status: row.status as BatteryRequestStatus };
  }

  async listRequests(status: BatteryRequestStatus | 'ALL', limit: number) {
    const rows = await db.select().from(batteryRequests).where(status === 'ALL' ? undefined : eq(batteryRequests.status, status)).orderBy(desc(batteryRequests.createdAt)).limit(limit);
    return rows.map((r) => ({ ...r, status: r.status as BatteryRequestStatus }));
  }

  async findRequest(id: string) {
    const [row] = await db.select().from(batteryRequests).where(eq(batteryRequests.id, id)).limit(1);
    return row ? { ...row, status: row.status as BatteryRequestStatus } : null;
  }

  async resolveRequest(id: string, patch: Parameters<IBatteryFinderRepository['resolveRequest']>[1]) {
    const [row] = await db.update(batteryRequests).set({ ...patch, resolvedAt: new Date() }).where(eq(batteryRequests.id, id)).returning();
    return row ? { ...row, status: row.status as BatteryRequestStatus } : null;
  }

  async demandOverview(sinceDays: number): Promise<DemandOverview> {
    const since = new Date(Date.now() - sinceDays * 86_400_000);
    const q = async <T>(query: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(query)) as unknown as T[];
    const topBrands = await q<{ brandId: string | null; name: string; searches: number }>(sql`
      SELECT b.id AS "brandId", b.name, count(*)::int AS searches FROM battery_finder_events e
      JOIN devices d ON d.id = e.device_id JOIN device_brands b ON b.id = d.brand_id
      WHERE e.occurred_at >= ${since} AND e.event_type IN ('SEARCH','DEVICE_SELECTED') GROUP BY b.id, b.name ORDER BY searches DESC LIMIT 10`);
    const topDevices = await q<{ deviceId: string; label: string; searches: number; verifiedFits: number }>(sql`
      SELECT d.id AS "deviceId", d.brand || ' ' || d.model || COALESCE(' (' || d.model_number || ')', '') AS label, count(*)::int AS searches,
        (SELECT count(*) FROM product_device_compatibility c JOIN battery_profiles bp ON bp.product_id = c.product_id JOIN products p ON p.id = c.product_id WHERE c.device_id = d.id AND ${VERIFIED_PUBLIC})::int AS "verifiedFits"
      FROM battery_finder_events e JOIN devices d ON d.id = e.device_id
      WHERE e.occurred_at >= ${since} AND e.event_type IN ('SEARCH','DEVICE_SELECTED') GROUP BY d.id ORDER BY searches DESC LIMIT 15`);
    const topCodes = await q<{ query: string; searches: number }>(sql`
      SELECT e.query_normalised AS query, count(*)::int AS searches FROM battery_finder_events e
      WHERE e.occurred_at >= ${since} AND e.event_type = 'SEARCH' AND e.mode = 'SEARCH_CODE' AND e.query_normalised IS NOT NULL GROUP BY e.query_normalised ORDER BY searches DESC LIMIT 15`);
    const noResultQueries = await q<{ query: string; searches: number; lastAt: Date }>(sql`
      SELECT e.query_normalised AS query, count(*)::int AS searches, max(e.occurred_at) AS "lastAt" FROM battery_finder_events e
      WHERE e.occurred_at >= ${since} AND e.event_type = 'SEARCH' AND e.outcome = 'NO_RESULT' AND e.query_normalised IS NOT NULL GROUP BY e.query_normalised ORDER BY searches DESC LIMIT 25`);
    const devicesWithoutBattery = await q<{ deviceId: string; label: string; searches: number }>(sql`
      SELECT d.id AS "deviceId", d.brand || ' ' || d.model || COALESCE(' (' || d.model_number || ')', '') AS label, count(*)::int AS searches
      FROM battery_finder_events e JOIN devices d ON d.id = e.device_id
      WHERE e.occurred_at >= ${since} AND e.event_type IN ('SEARCH','DEVICE_SELECTED') AND e.result_count = 0
      GROUP BY d.id HAVING count(*) >= 2 ORDER BY searches DESC LIMIT 15`);
    const outOfStockDemand = await q<{ productId: string; canonicalCode: string; name: string; views: number }>(sql`
      SELECT p.id AS "productId", bp.canonical_code AS "canonicalCode", p.name, count(*)::int AS views
      FROM battery_finder_events e JOIN products p ON p.id = e.battery_product_id JOIN battery_profiles bp ON bp.product_id = p.id
      WHERE e.occurred_at >= ${since} AND e.outcome = 'VERIFIED_OUT_OF_STOCK' GROUP BY p.id, bp.canonical_code ORDER BY views DESC LIMIT 15`);
    const [funnel] = await q<{ searches: number; productViews: number; cartAdds: number; searchSessions: number; viewSessions: number; cartSessions: number }>(sql`
      SELECT count(*) FILTER (WHERE event_type = 'SEARCH')::int AS searches,
             count(*) FILTER (WHERE event_type = 'PRODUCT_VIEWED')::int AS "productViews",
             count(*) FILTER (WHERE event_type = 'ADDED_TO_CART')::int AS "cartAdds",
             count(DISTINCT session_hash) FILTER (WHERE event_type = 'SEARCH' AND session_hash IS NOT NULL)::int AS "searchSessions",
             count(DISTINCT session_hash) FILTER (WHERE event_type = 'PRODUCT_VIEWED' AND session_hash IS NOT NULL)::int AS "viewSessions",
             count(DISTINCT session_hash) FILTER (WHERE event_type = 'ADDED_TO_CART' AND session_hash IS NOT NULL)::int AS "cartSessions"
      FROM battery_finder_events WHERE occurred_at >= ${since}`);
    const aliasCorrections = await q<{ query: string; searches: number }>(sql`
      SELECT e.query_normalised AS query, count(*)::int AS searches FROM battery_finder_events e
      WHERE e.occurred_at >= ${since} AND e.event_type = 'SEARCH' AND e.alias_hit AND e.query_normalised IS NOT NULL GROUP BY e.query_normalised HAVING count(*) >= 2 ORDER BY searches DESC LIMIT 15`);
    const ambiguousQueries = await q<{ query: string; searches: number }>(sql`
      SELECT e.query_normalised AS query, count(*)::int AS searches FROM battery_finder_events e
      WHERE e.occurred_at >= ${since} AND e.event_type = 'SEARCH' AND e.outcome = 'AMBIGUOUS' AND e.query_normalised IS NOT NULL GROUP BY e.query_normalised ORDER BY searches DESC LIMIT 15`);
    const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);
    return {
      since,
      topBrands,
      topDevices,
      topCodes,
      noResultQueries,
      devicesWithoutBattery,
      outOfStockDemand,
      searchToProduct: { searches: funnel?.searchSessions ?? 0, productViews: funnel?.viewSessions ?? 0, rate: rate(funnel?.viewSessions ?? 0, funnel?.searchSessions ?? 0) },
      searchToCart: { searches: funnel?.searchSessions ?? 0, cartAdds: funnel?.cartSessions ?? 0, rate: rate(funnel?.cartSessions ?? 0, funnel?.searchSessions ?? 0) },
      aliasCorrections,
      ambiguousQueries,
    };
  }
}

export { batteryAliases };
