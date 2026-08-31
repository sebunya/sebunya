import { and, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import { client, db } from '../client';
import { categories, productPrices, products } from '../schema/products';
import { productImages } from '../schema/phase11';
import { auditLogs } from '../schema/system';
import { mediaAssets } from '../schema/media';
import { devices, productDeviceCompatibility } from '../schema/devices';
import {
  batteryAliases,
  batteryEvidenceAssets,
  batteryImportRows,
  batteryProfiles,
  batteryRequests,
  inventoryMovements,
} from '../schema/batteries';
import type {
  BatteryAliasRecord,
  BatteryCreateInput,
  BatteryDashboardCounts,
  BatteryListFilters,
  BatteryListRow,
  BatteryProductFacts,
  BatteryProfileRecord,
  EvidenceAssetRecord,
  IBatteryCatalogueRepository,
} from '../../../application/ports/IBatteryCatalogueRepository';
import type { BatteryAliasType, BatteryCategory, BatteryChemistry, BatteryLifecycleStatus, EvidenceKind } from '@goldplus/shared';
import { VERIFIED_EVIDENCE_STATUSES } from '@goldplus/shared';
import { likeContains } from '../like';

const jsonb = (value: unknown) => sql`${client.json(value as never)}::jsonb`;
const num = (v: string | number | null | undefined): number | null => (v == null ? null : Number(v));

function profileRecord(row: typeof batteryProfiles.$inferSelect): BatteryProfileRecord {
  return {
    ...row,
    batteryCategory: row.batteryCategory as BatteryCategory,
    chemistry: (row.chemistry as BatteryChemistry | null) ?? null,
    lifecycleStatus: row.lifecycleStatus as BatteryLifecycleStatus,
    wattHours: num(row.wattHours),
    lengthMm: num(row.lengthMm),
    widthMm: num(row.widthMm),
    thicknessMm: num(row.thicknessMm),
    weightG: num(row.weightG),
  };
}

const MOVEMENTS = sql<number>`(SELECT count(*) FROM inventory_movements m WHERE m.product_id = ${sql.raw("products.id")})::int`;
const IMAGES = sql<number>`(SELECT count(*) FROM product_images i WHERE i.product_id = ${sql.raw("products.id")})::int`;
const PRIMARY_IMAGE = sql<string | null>`COALESCE(${products.imageUrl}, (SELECT i.url FROM product_images i WHERE i.product_id = ${sql.raw("products.id")} ORDER BY i.is_primary DESC, i.display_order ASC LIMIT 1))`;

function productFacts(row: {
  id: string; sku: string; slug: string; name: string; shortDescription: string; longDescription: string; categoryName: string | null; subcategory: string | null;
  priceUgx: number; hasRetailPrice: boolean; hasImage: boolean; primaryImageUrl: string | null; imageCount: number; approvalStatus: string; active: boolean;
  stockQuantity: number; reservedQuantity: number; stockStatus: string; movementCount: number;
}): BatteryProductFacts {
  return {
    productId: row.id,
    sku: row.sku,
    slug: row.slug,
    name: row.name,
    shortDescription: row.shortDescription,
    longDescription: row.longDescription,
    categoryName: row.categoryName,
    subcategory: row.subcategory,
    priceUgx: row.priceUgx,
    hasRetailPrice: row.hasRetailPrice,
    hasImage: row.hasImage || !!row.primaryImageUrl,
    primaryImageUrl: row.primaryImageUrl,
    imageCount: row.imageCount,
    approvalStatus: row.approvalStatus,
    active: row.active,
    stockQuantity: row.stockQuantity,
    reservedQuantity: row.reservedQuantity,
    stockStatus: row.stockStatus,
    movementCount: row.movementCount,
  };
}

const productSelection = {
  id: products.id, sku: products.sku, slug: products.slug, name: products.name, shortDescription: products.shortDescription, longDescription: products.longDescription,
  categoryName: products.categoryName, subcategory: products.subcategory, priceUgx: products.priceUgx, hasRetailPrice: products.hasRetailPrice, hasImage: products.hasImage,
  primaryImageUrl: PRIMARY_IMAGE, imageCount: IMAGES, approvalStatus: products.approvalStatus, active: products.active, stockQuantity: products.stockQuantity,
  reservedQuantity: products.reservedQuantity, stockStatus: products.stockStatus, movementCount: MOVEMENTS,
};

export class DrizzleBatteryCatalogueRepository implements IBatteryCatalogueRepository {
  async floorPriceFor(productId: string): Promise<number | null> {
    const [row] = await db.select({ floor: productPrices.floorPrice }).from(productPrices).where(eq(productPrices.productId, productId)).limit(1);
    return row?.floor ?? null;
  }

  async findCategoryBySlug(slug: string) {
    const [row] = await db.select({ id: categories.id, name: categories.name }).from(categories).where(eq(categories.slug, slug)).limit(1);
    return row ?? null;
  }

  async create(input: BatteryCreateInput) {
    return db.transaction(async (tx) => {
      const [product] = await tx.insert(products).values({
        sku: input.sku,
        modelNumber: input.profile.canonicalCode,
        name: input.name,
        slug: input.slug,
        categoryId: input.categoryId,
        categoryName: input.categoryName,
        subcategory: input.subcategory,
        shortDescription: input.shortDescription,
        longDescription: input.longDescription,
        priceUgx: input.priceUgx,
        hasRetailPrice: input.priceUgx > 0,
        stockStatus: 'out_of_stock',
        stockQuantity: 0,
        active: false,
        approvalStatus: 'draft',
        hasImage: false,
        features: jsonb([]) as never,
        specifications: jsonb({}) as never,
      }).returning({ id: products.id });
      await tx.insert(productPrices).values({ productId: product.id, retailPrice: input.priceUgx });
      const p = input.profile;
      const [profile] = await tx.insert(batteryProfiles).values({
        productId: product.id,
        canonicalCode: p.canonicalCode,
        canonicalCodeNormalised: p.canonicalCodeNormalised,
        codeStatus: p.codeStatus ?? 'PROVISIONAL',
        supplierCode: p.supplierCode ?? null,
        barcode: p.barcode ?? null,
        batteryCategory: p.batteryCategory,
        chemistry: p.chemistry ?? null,
        nominalVoltageMv: p.nominalVoltageMv ?? null,
        capacityMah: p.capacityMah ?? null,
        wattHours: p.wattHours == null ? null : String(p.wattHours),
        lengthMm: p.lengthMm == null ? null : String(p.lengthMm),
        widthMm: p.widthMm == null ? null : String(p.widthMm),
        thicknessMm: p.thicknessMm == null ? null : String(p.thicknessMm),
        weightG: p.weightG == null ? null : String(p.weightG),
        connectorNotes: p.connectorNotes ?? null,
        warrantyMonths: p.warrantyMonths ?? null,
        supplierName: p.supplierName ?? null,
        supplierReference: p.supplierReference ?? null,
        packagingNotes: p.packagingNotes ?? null,
        safetyNotes: p.safetyNotes ?? null,
        internalNotes: p.internalNotes ?? null,
        publicNotes: p.publicNotes ?? null,
        lifecycleStatus: p.lifecycleStatus ?? 'DRAFT',
        verificationStatus: p.verificationStatus ?? 'UNVERIFIED',
        sourceImportSessionId: p.sourceImportSessionId ?? null,
        sourceReference: p.sourceReference ?? null,
        createdBy: input.actorId,
        updatedBy: input.actorId,
      }).returning({ id: batteryProfiles.id });
      if (input.aliases.length) {
        await tx.insert(batteryAliases).values(input.aliases.map((a) => ({
          batteryProductId: product.id,
          alias: a.alias,
          aliasNormalised: a.aliasNormalised,
          aliasType: a.aliasType,
          source: a.source,
          verificationStatus: a.aliasType === 'CANONICAL' ? 'VERIFIED' : 'UNVERIFIED',
          createdBy: input.actorId,
        })));
      }
      return { productId: product.id, profileId: profile.id };
    });
  }

  private async findWhere(where: ReturnType<typeof eq>) {
    const [row] = await db
      .select({ profile: batteryProfiles, product: productSelection })
      .from(batteryProfiles)
      .innerJoin(products, eq(products.id, batteryProfiles.productId))
      .where(where)
      .limit(1);
    if (!row) return null;
    return { profile: profileRecord(row.profile), product: productFacts(row.product as never) };
  }

  findByProductId(productId: string) {
    return this.findWhere(eq(batteryProfiles.productId, productId));
  }

  findByProductSlug(slug: string) {
    return this.findWhere(eq(products.slug, slug));
  }

  async list(filters: BatteryListFilters): Promise<BatteryListRow[]> {
    const conditions = [];
    if (filters.status && filters.status !== 'ALL') conditions.push(eq(batteryProfiles.lifecycleStatus, filters.status));
    else if (!filters.status) conditions.push(sql`${batteryProfiles.lifecycleStatus} <> 'ARCHIVED'`);
    if (filters.category) conditions.push(eq(batteryProfiles.batteryCategory, filters.category));
    if (filters.verification) conditions.push(eq(batteryProfiles.verificationStatus, filters.verification));
    if (filters.q && filters.q.trim()) {
      const needle = likeContains(filters.q.trim());
      const norm = filters.q.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '');
      conditions.push(or(
        ilike(batteryProfiles.canonicalCode, needle),
        ilike(products.name, needle),
        ilike(products.sku, needle),
        eq(batteryProfiles.barcode, filters.q.trim()),
        ilike(batteryProfiles.supplierCode, needle),
        sql`EXISTS (SELECT 1 FROM battery_aliases a WHERE a.battery_product_id = ${sql.raw("products.id")} AND a.is_active AND a.alias_normalised LIKE ${likeContains(norm)})`,
        sql`EXISTS (SELECT 1 FROM product_device_compatibility c JOIN devices d ON d.id = c.device_id WHERE c.product_id = ${sql.raw("products.id")} AND (d.model ILIKE ${needle} OR d.brand ILIKE ${needle} OR d.model_number ILIKE ${needle}))`,
      )!);
    }
    switch (filters.missing) {
      case 'price': conditions.push(sql`${products.priceUgx} <= 0`); break;
      case 'image': conditions.push(sql`${products.imageUrl} IS NULL AND NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = ${sql.raw("products.id")})`); break;
      case 'stock': conditions.push(sql`${products.stockQuantity} <= 0`); break;
      case 'specs': conditions.push(sql`(${batteryProfiles.capacityMah} IS NULL OR ${batteryProfiles.nominalVoltageMv} IS NULL)`); break;
      case 'compatibility': conditions.push(sql`NOT EXISTS (SELECT 1 FROM product_device_compatibility c WHERE c.product_id = ${sql.raw("products.id")} AND c.workflow_status IN ('READY','ACTIVE') AND c.evidence_status IN ('PACKAGE_VERIFIED','FIT_TESTED','VERIFIED_EXACT','CONDITIONAL'))`); break;
      case 'code': conditions.push(sql`${batteryProfiles.codeStatus} <> 'CONFIRMED'`); break;
    }
    const rows = await db
      .select({
        profile: batteryProfiles,
        product: productSelection,
        aliasCount: sql<number>`(SELECT count(*) FROM battery_aliases a WHERE a.battery_product_id = ${sql.raw("products.id")} AND a.is_active)::int`,
        compatTotal: sql<number>`(SELECT count(*) FROM product_device_compatibility c WHERE c.product_id = ${sql.raw("products.id")})::int`,
        compatActive: sql<number>`(SELECT count(*) FROM product_device_compatibility c WHERE c.product_id = ${sql.raw("products.id")} AND c.workflow_status = 'ACTIVE')::int`,
        compatReady: sql<number>`(SELECT count(*) FROM product_device_compatibility c WHERE c.product_id = ${sql.raw("products.id")} AND c.workflow_status = 'READY')::int`,
        compatReview: sql<number>`(SELECT count(*) FROM product_device_compatibility c WHERE c.product_id = ${sql.raw("products.id")} AND c.workflow_status = 'REVIEW')::int`,
        compatDraft: sql<number>`(SELECT count(*) FROM product_device_compatibility c WHERE c.product_id = ${sql.raw("products.id")} AND c.workflow_status = 'DRAFT')::int`,
        compatVerified: sql<number>`(SELECT count(*) FROM product_device_compatibility c WHERE c.product_id = ${sql.raw("products.id")} AND c.workflow_status IN ('READY','ACTIVE') AND c.evidence_status IN ('PACKAGE_VERIFIED','FIT_TESTED','VERIFIED_EXACT'))::int`,
      })
      .from(batteryProfiles)
      .innerJoin(products, eq(products.id, batteryProfiles.productId))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(batteryProfiles.updatedAt))
      .limit(filters.limit ?? 200);
    return rows.map((r) => ({
      profile: profileRecord(r.profile),
      product: productFacts(r.product as never),
      aliasCount: r.aliasCount,
      compatibility: { total: r.compatTotal, active: r.compatActive, ready: r.compatReady, review: r.compatReview, draft: r.compatDraft, verified: r.compatVerified },
    }));
  }

  async updateProfile(productId: string, patch: Partial<BatteryProfileRecord>, actorId: string) {
    const set: Record<string, unknown> = { updatedBy: actorId, updatedAt: new Date() };
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'id' || k === 'productId' || k === 'createdAt' || k === 'updatedAt') continue;
      set[k] = ['wattHours', 'lengthMm', 'widthMm', 'thicknessMm', 'weightG'].includes(k) ? (v == null ? null : String(v)) : v;
    }
    const [row] = await db.update(batteryProfiles).set(set as never).where(eq(batteryProfiles.productId, productId)).returning();
    if (patch.canonicalCode) await db.update(products).set({ modelNumber: patch.canonicalCode, updatedAt: new Date() }).where(eq(products.id, productId));
    return row ? profileRecord(row) : null;
  }

  async updateProduct(productId: string, patch: { name?: string; shortDescription?: string; longDescription?: string; subcategory?: string; slug?: string }) {
    await db.update(products).set({ ...patch, updatedAt: new Date() }).where(eq(products.id, productId));
  }

  async setRetailPrice(productId: string, priceUgx: number) {
    return db.transaction(async (tx) => {
      const [before] = await tx.select({ price: products.priceUgx }).from(products).where(eq(products.id, productId)).for('update');
      await tx.update(products).set({ priceUgx, hasRetailPrice: priceUgx > 0, updatedAt: new Date() }).where(eq(products.id, productId));
      const [price] = await tx.select({ id: productPrices.id, floor: productPrices.floorPrice }).from(productPrices).where(eq(productPrices.productId, productId)).limit(1);
      // Defence in depth for the import path: name the rule instead of letting
      // the CHECK constraint surface as an opaque database error.
      if (price?.floor != null && priceUgx > 0 && priceUgx < price.floor) {
        throw new Error(`PRICE_BELOW_FLOOR: UGX ${priceUgx} is below this battery's floor (Price A) of UGX ${price.floor}.`);
      }
      if (price) await tx.update(productPrices).set({ retailPrice: priceUgx }).where(eq(productPrices.productId, productId));
      else await tx.insert(productPrices).values({ productId, retailPrice: priceUgx });
      return { before: before?.price ?? 0, after: priceUgx };
    });
  }

  async setProductPublication(productId: string, published: boolean) {
    await db.update(products).set({ approvalStatus: published ? 'approved' : 'draft', active: published, updatedAt: new Date() }).where(eq(products.id, productId));
  }

  async skuExists(sku: string) {
    const [row] = await db.select({ id: products.id }).from(products).where(eq(products.sku, sku)).limit(1);
    return !!row;
  }

  async slugExists(slug: string) {
    const [row] = await db.select({ id: products.id }).from(products).where(eq(products.slug, slug)).limit(1);
    return !!row;
  }

  async aliasesFor(productId: string): Promise<BatteryAliasRecord[]> {
    const rows = await db.select().from(batteryAliases).where(eq(batteryAliases.batteryProductId, productId)).orderBy(desc(batteryAliases.isActive), batteryAliases.aliasType, batteryAliases.alias);
    return rows.map((r) => ({ ...r, aliasType: r.aliasType as BatteryAliasType }));
  }

  async aliasOwners(normalised: string[]) {
    const keys = Array.from(new Set(normalised.filter(Boolean)));
    if (!keys.length) return [];
    const viaAlias = await db
      .select({ aliasNormalised: batteryAliases.aliasNormalised, productId: batteryAliases.batteryProductId, canonicalCode: batteryProfiles.canonicalCode })
      .from(batteryAliases)
      .innerJoin(batteryProfiles, eq(batteryProfiles.productId, batteryAliases.batteryProductId))
      .where(and(inArray(batteryAliases.aliasNormalised, keys), eq(batteryAliases.isActive, true), sql`${batteryProfiles.lifecycleStatus} <> 'ARCHIVED'`));
    const viaCode = await db
      .select({ aliasNormalised: batteryProfiles.canonicalCodeNormalised, productId: batteryProfiles.productId, canonicalCode: batteryProfiles.canonicalCode })
      .from(batteryProfiles)
      .where(and(inArray(batteryProfiles.canonicalCodeNormalised, keys), sql`${batteryProfiles.lifecycleStatus} <> 'ARCHIVED'`));
    const seen = new Set<string>();
    return [...viaAlias, ...viaCode].filter((r) => {
      const k = `${r.aliasNormalised}|${r.productId}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }

  async addAlias(input: { productId: string; alias: string; aliasNormalised: string; aliasType: BatteryAliasType; source: string | null; verificationStatus?: string; actorId: string }) {
    const [row] = await db.insert(batteryAliases).values({
      batteryProductId: input.productId,
      alias: input.alias,
      aliasNormalised: input.aliasNormalised,
      aliasType: input.aliasType,
      source: input.source,
      verificationStatus: input.verificationStatus ?? (input.aliasType === 'CANONICAL' ? 'VERIFIED' : 'UNVERIFIED'),
      createdBy: input.actorId,
    }).returning();
    return { ...row, aliasType: row.aliasType as BatteryAliasType };
  }

  async setAliasActive(aliasId: string, active: boolean) {
    const [row] = await db.update(batteryAliases).set({ isActive: active, updatedAt: new Date() }).where(eq(batteryAliases.id, aliasId)).returning();
    return row ? { ...row, aliasType: row.aliasType as BatteryAliasType } : null;
  }

  async resolveCode(candidates: string[], barcode: string | null) {
    const keys = candidates.filter(Boolean);
    const out: Array<{ productId: string; canonicalCode: string; lifecycleStatus: string; matchedOn: string }> = [];
    if (barcode) {
      const rows = await db.select({ productId: batteryProfiles.productId, canonicalCode: batteryProfiles.canonicalCode, lifecycleStatus: batteryProfiles.lifecycleStatus }).from(batteryProfiles).where(and(eq(batteryProfiles.barcode, barcode), sql`${batteryProfiles.lifecycleStatus} <> 'ARCHIVED'`));
      out.push(...rows.map((r) => ({ ...r, matchedOn: 'barcode' })));
    }
    if (keys.length) {
      // A bound JS array is ONE parameter to Postgres, so `= ANY($1)` asks it to
      // read a code as an array literal and fails. The candidate forms are
      // expanded into a real IN list instead, each its own parameter.
      const keyList = sql.join(keys.map((k) => sql`${k}`), sql`, `);
      const byCode = await db.select({ productId: batteryProfiles.productId, canonicalCode: batteryProfiles.canonicalCode, lifecycleStatus: batteryProfiles.lifecycleStatus }).from(batteryProfiles).where(and(inArray(batteryProfiles.canonicalCodeNormalised, keys), sql`${batteryProfiles.lifecycleStatus} <> 'ARCHIVED'`));
      out.push(...byCode.map((r) => ({ ...r, matchedOn: 'canonical' })));
      const bySupplier = await db.select({ productId: batteryProfiles.productId, canonicalCode: batteryProfiles.canonicalCode, lifecycleStatus: batteryProfiles.lifecycleStatus }).from(batteryProfiles).where(and(sql`upper(regexp_replace(coalesce(${batteryProfiles.supplierCode}, ''), '[^A-Za-z0-9]', '', 'g')) IN (${keyList})`, sql`${batteryProfiles.lifecycleStatus} <> 'ARCHIVED'`));
      out.push(...bySupplier.map((r) => ({ ...r, matchedOn: 'supplier' })));
      const byAlias = await db
        .select({ productId: batteryAliases.batteryProductId, canonicalCode: batteryProfiles.canonicalCode, lifecycleStatus: batteryProfiles.lifecycleStatus, alias: batteryAliases.alias })
        .from(batteryAliases)
        .innerJoin(batteryProfiles, eq(batteryProfiles.productId, batteryAliases.batteryProductId))
        .where(and(inArray(batteryAliases.aliasNormalised, keys), eq(batteryAliases.isActive, true), sql`${batteryProfiles.lifecycleStatus} <> 'ARCHIVED'`));
      out.push(...byAlias.map((r) => ({ productId: r.productId, canonicalCode: r.canonicalCode, lifecycleStatus: r.lifecycleStatus, matchedOn: `alias:${r.alias}` })));
      const bySku = await db
        .select({ productId: batteryProfiles.productId, canonicalCode: batteryProfiles.canonicalCode, lifecycleStatus: batteryProfiles.lifecycleStatus })
        .from(batteryProfiles)
        .innerJoin(products, eq(products.id, batteryProfiles.productId))
        .where(and(sql`upper(regexp_replace(${products.sku}, '[^A-Za-z0-9]', '', 'g')) IN (${keyList})`, sql`${batteryProfiles.lifecycleStatus} <> 'ARCHIVED'`));
      out.push(...bySku.map((r) => ({ ...r, matchedOn: 'sku' })));
    }
    return out;
  }

  async suggestCodes(normalisedQuery: string, limit: number) {
    if (normalisedQuery.length < 2) return [];
    const rows = await db.execute(sql`
      SELECT p.product_id AS "productId", p.canonical_code AS "canonicalCode", pr.slug, pr.name,
             GREATEST(similarity(p.canonical_code_normalised, ${normalisedQuery}),
                      COALESCE((SELECT max(similarity(a.alias_normalised, ${normalisedQuery})) FROM battery_aliases a WHERE a.battery_product_id = p.product_id AND a.is_active), 0)) AS score
      FROM battery_profiles p JOIN products pr ON pr.id = p.product_id
      WHERE p.lifecycle_status <> 'ARCHIVED'
        AND (p.canonical_code_normalised % ${normalisedQuery} OR p.canonical_code_normalised LIKE ${`${normalisedQuery}%`}
             OR EXISTS (SELECT 1 FROM battery_aliases a WHERE a.battery_product_id = p.product_id AND a.is_active AND (a.alias_normalised % ${normalisedQuery} OR a.alias_normalised LIKE ${`${normalisedQuery}%`})))
      ORDER BY score DESC, p.canonical_code
      LIMIT ${Math.min(limit, 20)}`);
    return (rows as unknown as Array<{ productId: string; canonicalCode: string; slug: string; name: string; score: number }>).map((r) => ({ ...r, score: Number(r.score) }));
  }

  async addEvidence(input: { subjectType: 'BATTERY' | 'COMPATIBILITY'; subjectId: string; assetId: string; kind: EvidenceKind; note: string | null; actorId: string }): Promise<EvidenceAssetRecord> {
    const [row] = await db.insert(batteryEvidenceAssets).values({ subjectType: input.subjectType, subjectId: input.subjectId, assetId: input.assetId, kind: input.kind, note: input.note, createdBy: input.actorId }).returning();
    const [asset] = await db.select({ url: mediaAssets.url }).from(mediaAssets).where(eq(mediaAssets.id, input.assetId)).limit(1);
    return { ...row, subjectType: row.subjectType as 'BATTERY' | 'COMPATIBILITY', kind: row.kind as EvidenceKind, url: asset?.url ?? '' };
  }

  async evidenceFor(subjectType: 'BATTERY' | 'COMPATIBILITY', subjectId: string): Promise<EvidenceAssetRecord[]> {
    const rows = await db
      .select({ e: batteryEvidenceAssets, url: mediaAssets.url })
      .from(batteryEvidenceAssets)
      .innerJoin(mediaAssets, eq(mediaAssets.id, batteryEvidenceAssets.assetId))
      .where(and(eq(batteryEvidenceAssets.subjectType, subjectType), eq(batteryEvidenceAssets.subjectId, subjectId)))
      .orderBy(desc(batteryEvidenceAssets.createdAt));
    return rows.map((r) => ({ ...r.e, subjectType: r.e.subjectType as 'BATTERY' | 'COMPATIBILITY', kind: r.e.kind as EvidenceKind, url: r.url }));
  }

  async setPrimaryImageFromAsset(productId: string, assetId: string, url: string, altText: string | null) {
    await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: productImages.id }).from(productImages).where(and(eq(productImages.productId, productId), eq(productImages.assetId, assetId))).limit(1);
      if (!existing) await tx.insert(productImages).values({ productId, url, altText, isPrimary: true, displayOrder: 0, assetId });
      await tx.update(products).set({ imageUrl: url, hasImage: true, updatedAt: new Date() }).where(eq(products.id, productId));
    });
  }

  async mappingsSummary(productId: string) {
    const rows = await db
      .select({ id: productDeviceCompatibility.id, workflowStatus: productDeviceCompatibility.workflowStatus, evidenceStatus: productDeviceCompatibility.evidenceStatus, deviceStatus: devices.status })
      .from(productDeviceCompatibility)
      .innerJoin(devices, eq(devices.id, productDeviceCompatibility.deviceId))
      .where(eq(productDeviceCompatibility.productId, productId));
    return rows;
  }

  async dashboard(): Promise<BatteryDashboardCounts> {
    const verified = VERIFIED_EVIDENCE_STATUSES.map((s) => `'${s}'`).join(',');
    const [counts] = (await db.execute(sql`
      SELECT
        count(*) FILTER (WHERE bp.lifecycle_status <> 'ARCHIVED')::int AS total,
        count(*) FILTER (WHERE bp.lifecycle_status = 'ACTIVE')::int AS active,
        count(*) FILTER (WHERE bp.lifecycle_status = 'DRAFT')::int AS draft,
        count(*) FILTER (WHERE bp.lifecycle_status = 'REVIEW')::int AS review,
        count(*) FILTER (WHERE bp.lifecycle_status = 'READY')::int AS ready,
        count(*) FILTER (WHERE bp.lifecycle_status = 'ARCHIVED')::int AS archived,
        count(*) FILTER (WHERE bp.lifecycle_status <> 'ARCHIVED' AND p.stock_quantity <= 0)::int AS without_stock,
        count(*) FILTER (WHERE bp.lifecycle_status <> 'ARCHIVED' AND p.price_ugx <= 0)::int AS without_price,
        count(*) FILTER (WHERE bp.lifecycle_status <> 'ARCHIVED' AND p.image_url IS NULL AND NOT EXISTS (SELECT 1 FROM product_images i WHERE i.product_id = p.id))::int AS without_image,
        count(*) FILTER (WHERE bp.lifecycle_status <> 'ARCHIVED' AND (bp.capacity_mah IS NULL OR bp.nominal_voltage_mv IS NULL))::int AS missing_specs,
        count(*) FILTER (WHERE bp.lifecycle_status <> 'ARCHIVED' AND bp.verification_status <> 'VERIFIED')::int AS unverified_batteries
      FROM battery_profiles bp JOIN products p ON p.id = bp.product_id`)) as unknown as Array<Record<string, number>>;
    const [claims] = (await db.execute(sql`
      SELECT
        count(*) FILTER (WHERE c.workflow_status IN ('DRAFT','REVIEW') AND c.evidence_status NOT IN (${sql.raw(verified)}))::int AS unverified_claims,
        count(*) FILTER (WHERE c.workflow_status = 'REVIEW')::int AS claims_in_review,
        count(*) FILTER (WHERE c.evidence_status = 'CONDITIONAL' AND c.workflow_status <> 'ARCHIVED')::int AS conditional_claims
      FROM product_device_compatibility c`)) as unknown as Array<Record<string, number>>;
    const [aliasConflicts] = (await db.execute(sql`
      SELECT count(*)::int AS n FROM (
        SELECT alias_normalised FROM (
          SELECT a.alias_normalised, a.battery_product_id AS pid FROM battery_aliases a WHERE a.is_active
          UNION
          SELECT bp.canonical_code_normalised, bp.product_id FROM battery_profiles bp WHERE bp.lifecycle_status <> 'ARCHIVED'
        ) x GROUP BY alias_normalised HAVING count(DISTINCT pid) > 1
      ) y`)) as unknown as Array<{ n: number }>;
    const [imports] = await db.select({ n: sql<number>`count(*)::int` }).from(batteryImportRows).where(inArray(batteryImportRows.status, ['HELD', 'INVALID']));
    const [requests] = await db.select({ n: sql<number>`count(*)::int` }).from(batteryRequests).where(eq(batteryRequests.status, 'OPEN'));
    const recent = await db
      .select({ entity: auditLogs.entity, entityId: auditLogs.entityId, action: auditLogs.action, at: auditLogs.createdAt, actorId: auditLogs.actorId, newState: auditLogs.newState })
      .from(auditLogs)
      .where(inArray(auditLogs.entity, ['battery', 'battery_compatibility', 'device', 'device_brand', 'device_series', 'stock_receipt', 'stock_count', 'battery_import', 'battery_request']))
      .orderBy(desc(auditLogs.createdAt))
      .limit(15);
    return {
      total: counts?.total ?? 0,
      active: counts?.active ?? 0,
      draft: counts?.draft ?? 0,
      review: counts?.review ?? 0,
      ready: counts?.ready ?? 0,
      archived: counts?.archived ?? 0,
      withoutStock: counts?.without_stock ?? 0,
      withoutPrice: counts?.without_price ?? 0,
      withoutImage: counts?.without_image ?? 0,
      missingSpecs: counts?.missing_specs ?? 0,
      unverifiedBatteries: counts?.unverified_batteries ?? 0,
      unverifiedClaims: claims?.unverified_claims ?? 0,
      claimsInReview: claims?.claims_in_review ?? 0,
      conditionalClaims: claims?.conditional_claims ?? 0,
      aliasConflicts: aliasConflicts?.n ?? 0,
      unresolvedImportRows: imports?.n ?? 0,
      openRequests: requests?.n ?? 0,
      recentChanges: recent.map((r) => ({ entity: r.entity, entityId: r.entityId, action: r.action, at: r.at, actorId: r.actorId, label: labelFromState(r.newState) })),
    };
  }
}

function labelFromState(state: unknown): string | null {
  if (!state || typeof state !== 'object') return null;
  const s = state as Record<string, unknown>;
  for (const key of ['canonicalCode', 'battery', 'device', 'name', 'model', 'supplier', 'reason']) if (typeof s[key] === 'string') return s[key] as string;
  return null;
}
