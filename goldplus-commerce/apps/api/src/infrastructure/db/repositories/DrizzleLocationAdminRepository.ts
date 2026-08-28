import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '../client';
import { addresses } from '../schema/addresses';
import {
  deliveryZonePolicy,
  ugArea,
  ugAreaAlias,
  ugDataException,
  ugLandmark,
  ugPickupPoint,
} from '../schema/locations';
import {
  DataExceptionRow,
  ILocationAdminRepository,
  LandmarkRow,
  PickupPointRow,
  ReviewQueueAddress,
  SearchMissGroup,
  ZonePolicyRow,
} from '../../../application/ports/ILocationAdmin';

export class DrizzleLocationAdminRepository implements ILocationAdminRepository {
  async listSearchMissGroups(limit: number): Promise<SearchMissGroup[]> {
    const rows = (await db.execute(sql`
      select normalised_query,
             count(*)::int as frequency,
             max(created_at) as last_seen,
             (array_agg(distinct raw_query))[1:5] as raw_samples,
             jsonb_object_agg(coalesce(resolved_via,'unresolved'), 1) as via_sample,
             (array_agg(resolved_area_slug) filter (where resolved_area_slug is not null))[1] as top_resolved
      from ug_search_miss
      group by normalised_query
      order by frequency desc, last_seen desc
      limit ${limit}`)) as unknown as Array<{
      normalised_query: string;
      frequency: number;
      last_seen: string;
      raw_samples: string[];
      via_sample: Record<string, number>;
      top_resolved: string | null;
    }>;
    // Aggregate resolved_via counts properly (jsonb_object_agg dedupes keys).
    const groups: SearchMissGroup[] = [];
    for (const r of rows) {
      const viaRows = (await db.execute(sql`
        select coalesce(resolved_via,'unresolved') as via, count(*)::int as n
        from ug_search_miss where normalised_query = ${r.normalised_query}
        group by 1`)) as unknown as Array<{ via: string; n: number }>;
      groups.push({
        normalisedQuery: r.normalised_query,
        rawSamples: r.raw_samples ?? [],
        frequency: Number(r.frequency),
        lastSeen: String(r.last_seen),
        resolvedVia: Object.fromEntries(viaRows.map((v) => [v.via, Number(v.n)])),
        topResolvedAreaSlug: r.top_resolved,
      });
    }
    return groups;
  }

  async areaExists(areaSlug: string): Promise<boolean> {
    const row = await db.query.ugArea.findFirst({ where: eq(ugArea.areaSlug, areaSlug) });
    return Boolean(row);
  }

  async createAlias(input: {
    alias: string;
    normalisedAlias: string;
    areaSlug: string;
    confidence: string;
    source: 'ops_promoted';
    createdBy: string;
    note?: string | null;
  }): Promise<{ created: boolean }> {
    const inserted = await db
      .insert(ugAreaAlias)
      .values({
        alias: input.alias,
        normalisedAlias: input.normalisedAlias,
        areaSlug: input.areaSlug,
        confidence: input.confidence,
        source: input.source,
        createdBy: input.createdBy,
        note: input.note ?? null,
      })
      .onConflictDoNothing({ target: [ugAreaAlias.normalisedAlias, ugAreaAlias.areaSlug] })
      .returning();
    return { created: inserted.length > 0 };
  }

  async markMissesResolved(normalisedQuery: string, areaSlug: string): Promise<number> {
    const result = (await db.execute(sql`
      update ug_search_miss
      set resolved_area_slug = ${areaSlug}, resolved_via = 'alias'
      where normalised_query = ${normalisedQuery} and resolved_area_slug is null`)) as unknown as { count?: number };
    return Number((result as { count?: number }).count ?? 0);
  }

  async listReviewQueue(limit: number): Promise<ReviewQueueAddress[]> {
    const rows = await db.query.addresses.findMany({
      where: and(eq(addresses.resolutionStatus, 'needs_ops_review'), isNull(addresses.deletedAt)),
      limit,
    });
    return rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      recipientName: r.recipientName,
      phone: r.phone,
      district: r.district,
      areaDetails: r.areaDetails,
      rawAddressText: r.rawAddressText,
      landmarkText: r.landmarkText,
      hasPin: r.gpsLat !== null && r.gpsLng !== null,
      gpsLat: r.gpsLat,
      gpsLng: r.gpsLng,
      resolutionStatus: r.resolutionStatus,
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async resolveAddress(input: {
    addressId: string;
    areaSlug: string;
    snapshotAreaLabel: string;
    snapshotDistrict: string;
    snapshotPostcode: string | null;
    snapshotDataVersion: number | null;
  }): Promise<{ before: unknown; after: unknown } | null> {
    return db.transaction(async (tx) => {
      const target = await tx.query.addresses.findFirst({
        where: and(eq(addresses.id, input.addressId), eq(addresses.resolutionStatus, 'needs_ops_review')),
      });
      if (!target) return null;
      // The original text is PRESERVED (raw_address_text / area_details stay
      // untouched) — resolution ADDS the structured link, never rewrites.
      const [after] = await tx
        .update(addresses)
        .set({
          areaSlug: input.areaSlug,
          district: input.snapshotDistrict,
          resolutionStatus: 'ops_confirmed',
          snapshotAreaLabel: input.snapshotAreaLabel,
          snapshotDistrict: input.snapshotDistrict,
          snapshotPostcode: input.snapshotPostcode,
          snapshotDataVersion: input.snapshotDataVersion,
          updatedAt: new Date(),
        })
        .where(eq(addresses.id, input.addressId))
        .returning();
      return { before: target, after };
    });
  }

  async areaSummary(areaSlug: string) {
    const row = await db.query.ugArea.findFirst({ where: eq(ugArea.areaSlug, areaSlug) });
    return row
      ? {
          displayLabel: row.displayLabel,
          currentDistrict: row.currentDistrict,
          postcode: row.postcode,
          dataVersion: row.dataVersion,
        }
      : null;
  }

  async listLandmarks(areaSlug: string | null, limit: number): Promise<LandmarkRow[]> {
    const rows = await db.query.ugLandmark.findMany({
      where: areaSlug ? eq(ugLandmark.areaSlug, areaSlug) : undefined,
      limit,
      orderBy: (l, { desc }) => [desc(l.usageCount)],
    });
    return rows.map((r) => ({
      id: r.id,
      areaSlug: r.areaSlug,
      name: r.name,
      landmarkType: r.landmarkType,
      usageCount: r.usageCount,
      verified: r.verified,
      gpsLat: r.gpsLat,
      gpsLng: r.gpsLng,
    }));
  }

  async upsertLandmark(input: {
    areaSlug: string;
    name: string;
    landmarkType: string;
    verified?: boolean;
    gpsLat?: number | null;
    gpsLng?: number | null;
  }): Promise<LandmarkRow> {
    const existing = (await db.execute(sql`
      select id from ug_landmark where area_slug = ${input.areaSlug} and lower(name) = lower(${input.name.trim()}) limit 1`)) as unknown as Array<{ id: string }>;
    if (existing.length > 0) {
      const [row] = await db
        .update(ugLandmark)
        .set({
          landmarkType: input.landmarkType,
          ...(input.verified !== undefined ? { verified: input.verified } : {}),
          ...(input.gpsLat !== undefined ? { gpsLat: input.gpsLat } : {}),
          ...(input.gpsLng !== undefined ? { gpsLng: input.gpsLng } : {}),
          updatedAt: new Date(),
        })
        .where(eq(ugLandmark.id, existing[0].id))
        .returning();
      return this.landmarkRow(row);
    }
    const [row] = await db
      .insert(ugLandmark)
      .values({
        areaSlug: input.areaSlug,
        name: input.name.trim(),
        landmarkType: input.landmarkType,
        verified: input.verified ?? true, // ops-entered landmarks are verified by definition
        gpsLat: input.gpsLat ?? null,
        gpsLng: input.gpsLng ?? null,
      })
      .returning();
    return this.landmarkRow(row);
  }

  private landmarkRow(r: typeof ugLandmark.$inferSelect): LandmarkRow {
    return {
      id: r.id,
      areaSlug: r.areaSlug,
      name: r.name,
      landmarkType: r.landmarkType,
      usageCount: r.usageCount,
      verified: r.verified,
      gpsLat: r.gpsLat,
      gpsLng: r.gpsLng,
    };
  }

  async setLandmarkVerified(id: string, verified: boolean): Promise<boolean> {
    const rows = await db.update(ugLandmark).set({ verified, updatedAt: new Date() }).where(eq(ugLandmark.id, id)).returning();
    return rows.length > 0;
  }

  async mergeLandmarks(keepId: string, mergeId: string): Promise<boolean> {
    if (keepId === mergeId) return false;
    return db.transaction(async (tx) => {
      const keep = await tx.query.ugLandmark.findFirst({ where: eq(ugLandmark.id, keepId) });
      const merge = await tx.query.ugLandmark.findFirst({ where: eq(ugLandmark.id, mergeId) });
      if (!keep || !merge) return false;
      await tx
        .update(ugLandmark)
        // Increment in SQL, not in JavaScript. Adding to the value we read
        // discards any usage the survivor recorded since that read.
        .set({ usageCount: sql`${ugLandmark.usageCount} + ${merge.usageCount}`, updatedAt: new Date() })
        .where(eq(ugLandmark.id, keepId));
      // The merged duplicate is retired, not hard-deleted — usage history is
      // aggregated onto the survivor and the row is de-listed by renaming.
      await tx
        .update(ugLandmark)
        .set({ name: `[merged:${keepId.slice(0, 8)}] ${merge.name}`.slice(0, 160), verified: false, usageCount: 0, updatedAt: new Date() })
        .where(eq(ugLandmark.id, mergeId));
      return true;
    });
  }

  async listPickupPoints(): Promise<PickupPointRow[]> {
    const rows = await db.query.ugPickupPoint.findMany();
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      operator: r.operator,
      areaSlug: r.areaSlug,
      physicalAddress: r.physicalAddress,
      landmarkText: r.landmarkText,
      phone: r.phone,
      openingHours: r.openingHours,
      servesDistricts: r.servesDistricts,
      active: r.active,
      notes: r.notes,
    }));
  }

  async upsertPickupPoint(input: Partial<PickupPointRow> & { name: string; operator: string }): Promise<PickupPointRow> {
    if (input.id) {
      const [row] = await db
        .update(ugPickupPoint)
        .set({
          name: input.name,
          operator: input.operator,
          areaSlug: input.areaSlug ?? null,
          physicalAddress: input.physicalAddress ?? null,
          landmarkText: input.landmarkText ?? null,
          phone: input.phone ?? null,
          openingHours: input.openingHours ?? null,
          servesDistricts: input.servesDistricts ?? null,
          notes: input.notes ?? null,
          updatedAt: new Date(),
        })
        .where(eq(ugPickupPoint.id, input.id))
        .returning();
      return (await this.listPickupPoints()).find((p) => p.id === row.id)!;
    }
    const [row] = await db
      .insert(ugPickupPoint)
      .values({
        name: input.name,
        operator: input.operator,
        areaSlug: input.areaSlug ?? null,
        physicalAddress: input.physicalAddress ?? null,
        landmarkText: input.landmarkText ?? null,
        phone: input.phone ?? null,
        openingHours: input.openingHours ?? null,
        servesDistricts: input.servesDistricts ?? null,
        active: false, // never active at creation — ops flips it deliberately
        notes: input.notes ?? null,
      })
      .returning();
    return (await this.listPickupPoints()).find((p) => p.id === row.id)!;
  }

  async setPickupPointActive(id: string, active: boolean): Promise<boolean> {
    const rows = await db.update(ugPickupPoint).set({ active, updatedAt: new Date() }).where(eq(ugPickupPoint.id, id)).returning();
    return rows.length > 0;
  }

  async listZonePolicies(): Promise<ZonePolicyRow[]> {
    const rows = await db.query.deliveryZonePolicy.findMany();
    return rows
      .map((r) => ({
        zoneCode: r.zoneCode,
        zoneName: r.zoneName,
        slaHoursMin: r.slaHoursMin,
        slaHoursMax: r.slaHoursMax,
        fallbackFeeUgx: r.fallbackFeeUgx,
        freeDeliveryThresholdUgx: r.freeDeliveryThresholdUgx,
        codAllowed: r.codAllowed,
        codMaxOrderValueUgx: r.codMaxOrderValueUgx,
        prepayRequiredAboveUgx: r.prepayRequiredAboveUgx,
        carrier: r.carrier,
        active: r.active,
      }))
      .sort((a, b) => a.zoneCode.localeCompare(b.zoneCode));
  }

  async saveZonePolicy(input: ZonePolicyRow & { updatedBy: string }): Promise<ZonePolicyRow> {
    const [row] = await db
      .update(deliveryZonePolicy)
      .set({
        zoneName: input.zoneName,
        slaHoursMin: input.slaHoursMin,
        slaHoursMax: input.slaHoursMax,
        fallbackFeeUgx: input.fallbackFeeUgx,
        freeDeliveryThresholdUgx: input.freeDeliveryThresholdUgx,
        codAllowed: input.codAllowed,
        codMaxOrderValueUgx: input.codMaxOrderValueUgx,
        prepayRequiredAboveUgx: input.prepayRequiredAboveUgx,
        carrier: input.carrier,
        active: input.active,
        updatedBy: input.updatedBy,
        updatedAt: new Date(),
      })
      .where(eq(deliveryZonePolicy.zoneCode, input.zoneCode))
      .returning();
    return {
      zoneCode: row.zoneCode,
      zoneName: row.zoneName,
      slaHoursMin: row.slaHoursMin,
      slaHoursMax: row.slaHoursMax,
      fallbackFeeUgx: row.fallbackFeeUgx,
      freeDeliveryThresholdUgx: row.freeDeliveryThresholdUgx,
      codAllowed: row.codAllowed,
      codMaxOrderValueUgx: row.codMaxOrderValueUgx,
      prepayRequiredAboveUgx: row.prepayRequiredAboveUgx,
      carrier: row.carrier,
      active: row.active,
    };
  }

  async listDataExceptions(): Promise<DataExceptionRow[]> {
    const rows = await db.query.ugDataException.findMany();
    return rows.map((r) => ({
      id: r.id,
      exceptionType: r.exceptionType,
      district: r.district,
      postcode: r.postcode,
      areaRef: r.areaRef,
      description: r.description,
    }));
  }
}
