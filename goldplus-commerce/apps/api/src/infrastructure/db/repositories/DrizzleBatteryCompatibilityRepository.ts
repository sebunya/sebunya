import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { devices, productDeviceCompatibility } from '../schema/devices';
import { batteryProfiles } from '../schema/batteries';
import { products } from '../schema/products';
import type { ClaimCreateInput, ClaimListFilters, ClaimPatch, CompatClaimRecord, IBatteryCompatibilityRepository } from '../../../application/ports/IBatteryCompatibilityRepository';
import type { CompatEvidenceStatus, CompatWorkflowStatus } from '@goldplus/shared';
import { deviceLabel } from '../../../domain/batteries/DeviceHierarchy';

const selection = {
  c: productDeviceCompatibility,
  batteryCode: batteryProfiles.canonicalCode,
  batteryLifecycle: batteryProfiles.lifecycleStatus,
  productName: products.name,
  productSlug: products.slug,
  d: devices,
};

function record(r: { c: typeof productDeviceCompatibility.$inferSelect; batteryCode: string; batteryLifecycle: string; productName: string; productSlug: string; d: typeof devices.$inferSelect }): CompatClaimRecord {
  return {
    id: r.c.id,
    productId: r.c.productId,
    deviceId: r.c.deviceId,
    fitType: r.c.fitType,
    confidence: r.c.confidence,
    evidenceStatus: r.c.evidenceStatus as CompatEvidenceStatus,
    workflowStatus: r.c.workflowStatus as CompatWorkflowStatus,
    evidenceType: r.c.evidenceType,
    evidenceSource: r.c.evidenceSource,
    evidenceAssetId: r.c.evidenceAssetId,
    notes: r.c.notes,
    publicCondition: r.c.publicCondition,
    createdBy: r.c.createdBy,
    submittedBy: r.c.submittedBy,
    submittedAt: r.c.submittedAt,
    reviewedBy: r.c.reviewedBy,
    reviewedAt: r.c.reviewedAt,
    reviewNote: r.c.reviewNote,
    publishedBy: r.c.publishedBy,
    publishedAt: r.c.publishedAt,
    archivedAt: r.c.archivedAt,
    verifiedBy: r.c.verifiedBy,
    verifiedAt: r.c.verifiedAt,
    sourceImportSessionId: r.c.sourceImportSessionId,
    sourceReference: r.c.sourceReference,
    createdAt: r.c.createdAt,
    updatedAt: r.c.updatedAt,
    battery: { canonicalCode: r.batteryCode, name: r.productName, slug: r.productSlug, lifecycleStatus: r.batteryLifecycle },
    device: {
      brandName: r.d.brand,
      model: r.d.model,
      modelNumber: r.d.modelNumber,
      variant: r.d.variant,
      slug: r.d.slug,
      status: r.d.status,
      label: deviceLabel({ brandName: r.d.brand, model: r.d.model, modelNumber: r.d.modelNumber, variant: r.d.variant }),
    },
  };
}

export class DrizzleBatteryCompatibilityRepository implements IBatteryCompatibilityRepository {
  private base() {
    return db.select(selection).from(productDeviceCompatibility)
      .innerJoin(batteryProfiles, eq(batteryProfiles.productId, productDeviceCompatibility.productId))
      .innerJoin(products, eq(products.id, productDeviceCompatibility.productId))
      .innerJoin(devices, eq(devices.id, productDeviceCompatibility.deviceId));
  }

  async list(filters: ClaimListFilters) {
    const conditions = [];
    if (filters.productId) conditions.push(eq(productDeviceCompatibility.productId, filters.productId));
    if (filters.deviceId) conditions.push(eq(productDeviceCompatibility.deviceId, filters.deviceId));
    if (filters.workflowStatus && filters.workflowStatus !== 'ALL') conditions.push(eq(productDeviceCompatibility.workflowStatus, filters.workflowStatus));
    else if (!filters.workflowStatus) conditions.push(sql`${productDeviceCompatibility.workflowStatus} <> 'ARCHIVED'`);
    if (filters.evidenceStatus) conditions.push(eq(productDeviceCompatibility.evidenceStatus, filters.evidenceStatus));
    const rows = await this.base().where(conditions.length ? and(...conditions) : undefined).orderBy(desc(productDeviceCompatibility.updatedAt)).limit(filters.limit ?? 200);
    return rows.map(record);
  }

  async find(id: string) {
    const [row] = await this.base().where(eq(productDeviceCompatibility.id, id)).limit(1);
    return row ? record(row) : null;
  }

  async findPair(productId: string, deviceId: string) {
    const [row] = await this.base().where(and(eq(productDeviceCompatibility.productId, productId), eq(productDeviceCompatibility.deviceId, deviceId))).limit(1);
    return row ? record(row) : null;
  }

  async create(input: ClaimCreateInput) {
    const [row] = await db.insert(productDeviceCompatibility).values({
      productId: input.productId,
      deviceId: input.deviceId,
      fitType: input.fitType,
      confidence: input.confidence,
      evidenceSource: input.evidenceSource,
      notes: input.notes,
      evidenceStatus: input.evidenceStatus,
      workflowStatus: 'DRAFT',
      evidenceType: input.evidenceType,
      publicCondition: input.publicCondition,
      createdBy: input.createdBy,
      sourceImportSessionId: input.sourceImportSessionId ?? null,
      sourceReference: input.sourceReference ?? null,
    }).returning({ id: productDeviceCompatibility.id });
    return (await this.find(row.id))!;
  }

  async update(id: string, patch: ClaimPatch) {
    await db.update(productDeviceCompatibility).set({ ...patch, updatedAt: new Date() } as never).where(eq(productDeviceCompatibility.id, id));
    return this.find(id);
  }

  async conflictsForDevice(deviceId: string, excludeProductId: string) {
    const rows = await db
      .select({ productId: productDeviceCompatibility.productId, canonicalCode: batteryProfiles.canonicalCode, evidenceStatus: productDeviceCompatibility.evidenceStatus, workflowStatus: productDeviceCompatibility.workflowStatus })
      .from(productDeviceCompatibility)
      .innerJoin(batteryProfiles, eq(batteryProfiles.productId, productDeviceCompatibility.productId))
      .where(and(eq(productDeviceCompatibility.deviceId, deviceId), sql`${productDeviceCompatibility.productId} <> ${excludeProductId}`, sql`${productDeviceCompatibility.workflowStatus} <> 'ARCHIVED'`));
    return rows;
  }

  async deviceIdsForBattery(productId: string) {
    const rows = await db.select({ deviceId: productDeviceCompatibility.deviceId }).from(productDeviceCompatibility).where(eq(productDeviceCompatibility.productId, productId));
    return rows.map((r) => r.deviceId);
  }
}
