import { desc, eq, sql } from 'drizzle-orm';
import { db } from '../client';
import { deliveryConfigValue, deliveryConfigVersion } from '../schema/delivery';
import {
  ConfigValueInput,
  ConfigVersionRow,
  IDeliveryConfigRepository,
} from '../../../application/use-cases/delivery/DeliveryConfigUseCases';
import { AreaInput, DistanceBand, isDistanceBand } from '../../../domain/delivery/DeliveryModel';
import { DeliveryAreaResolver } from '../../delivery/DeliveryAreaResolver';

type VersionRow = typeof deliveryConfigVersion.$inferSelect;

function toVersion(r: VersionRow): ConfigVersionRow {
  return {
    id: r.id,
    status: r.status,
    reason: r.reason ?? null,
    createdBy: r.createdBy ?? null,
    publishedBy: r.publishedBy ?? null,
    publishedAt: r.publishedAt ?? null,
    scheduledFor: r.scheduledFor ?? null,
    revertedFrom: r.revertedFrom ?? null,
    createdAt: r.createdAt,
  };
}

export class DrizzleDeliveryConfigRepository implements IDeliveryConfigRepository {
  constructor(private readonly resolver: DeliveryAreaResolver) {}

  async createDraft(input: { createdBy: string | null; reason: string | null; values: ConfigValueInput[] }): Promise<ConfigVersionRow> {
    return db.transaction(async (tx) => {
      const [version] = await tx
        .insert(deliveryConfigVersion)
        .values({ status: 'draft', reason: input.reason, createdBy: input.createdBy })
        .returning();
      if (input.values.length > 0) {
        await tx.insert(deliveryConfigValue).values(
          input.values.map((v) => ({
            versionId: version.id,
            configKey: v.key,
            configValue: v.value,
            origin: v.origin,
            sampleSize: v.sampleSize,
          })),
        );
      }
      return toVersion(version);
    });
  }

  async findVersion(versionId: string): Promise<ConfigVersionRow | null> {
    const row = await db.query.deliveryConfigVersion.findFirst({ where: eq(deliveryConfigVersion.id, versionId) });
    return row ? toVersion(row) : null;
  }

  async valuesForVersion(versionId: string): Promise<Record<string, string>> {
    const rows = await db.query.deliveryConfigValue.findMany({ where: eq(deliveryConfigValue.versionId, versionId) });
    const out: Record<string, string> = {};
    for (const r of rows) if (r.configValue !== null) out[r.configKey] = r.configValue;
    return out;
  }

  async valueRowsForVersion(versionId: string): Promise<ConfigValueInput[]> {
    const rows = await db.query.deliveryConfigValue.findMany({ where: eq(deliveryConfigValue.versionId, versionId) });
    return rows.map((r) => ({
      key: r.configKey,
      value: r.configValue ?? '',
      origin: (r.origin === 'model_proposed' ? 'model_proposed' : 'human') as 'human' | 'model_proposed',
      sampleSize: r.sampleSize ?? null,
    }));
  }

  /**
   * Exactly one version is `published` at a time.
   *
   * The demotion and the promotion are one transaction: a window in which two
   * versions are published would let the config reader pick either, and a fee
   * that depends on which query ran first is not a fee anyone can explain.
   */
  async publish(input: { versionId: string; publishedBy: string; scheduledFor: Date | null }): Promise<ConfigVersionRow> {
    return db.transaction(async (tx) => {
      await tx
        .update(deliveryConfigVersion)
        .set({ status: 'superseded' })
        .where(eq(deliveryConfigVersion.status, 'published'));
      const [row] = await tx
        .update(deliveryConfigVersion)
        .set({
          status: 'published',
          publishedBy: input.publishedBy,
          publishedAt: new Date(),
          scheduledFor: input.scheduledFor,
        })
        .where(eq(deliveryConfigVersion.id, input.versionId))
        .returning();
      return toVersion(row);
    });
  }

  async publishedVersion(): Promise<ConfigVersionRow | null> {
    const row = await db.query.deliveryConfigVersion.findFirst({
      where: eq(deliveryConfigVersion.status, 'published'),
      orderBy: [desc(deliveryConfigVersion.publishedAt)],
    });
    return row ? toVersion(row) : null;
  }

  async listVersions(limit: number): Promise<ConfigVersionRow[]> {
    const rows = await db.query.deliveryConfigVersion.findMany({
      orderBy: [desc(deliveryConfigVersion.createdAt)],
      limit,
    });
    return rows.map(toVersion);
  }

  /**
   * One real, named area per band for the mandatory preview.
   *
   * Deterministic and biased toward names an operator will recognise: Kampala
   * first, then alphabetical. A preview showing seven areas nobody has heard of
   * is a preview nobody checks.
   */
  async sampleAreaPerBand(): Promise<Array<{ band: DistanceBand; areaSlug: string; areaLabel: string; area: AreaInput }>> {
    const rows = (await db.execute(sql`
      select distinct on (distance_band)
             area_slug, area, district, corridor, distance_band, access_mode, serviceable
      from delivery_corridor
      where serviceable = true and access_mode = 'road'
      order by distance_band,
               (district = 'Kampala') desc,
               (district = 'Wakiso') desc,
               area`)) as unknown as Array<{
      area_slug: string;
      area: string;
      district: string;
      corridor: string;
      distance_band: string;
      access_mode: string;
      serviceable: boolean;
    }>;
    return rows
      .filter((r) => isDistanceBand(r.distance_band))
      .map((r) => ({
        band: r.distance_band as DistanceBand,
        areaSlug: r.area_slug,
        areaLabel: `${r.area}, ${r.district}`,
        area: {
          areaSlug: r.area_slug,
          district: r.district,
          corridor: r.corridor,
          band: r.distance_band as DistanceBand,
          accessMode: 'road' as const,
          serviceable: true,
          measuredKm: null,
          centroidSource: null,
        },
      }));
  }

  /**
   * Recent real orders, resolved to areas.
   *
   * "No publish without a preview against real orders" (PART 9 #27). With 18
   * orders in the book this is a small list, and an empty one is reported as a
   * fact rather than hidden — the band table is then the only check available
   * and the impact summary says so.
   */
  async recentOrderAreas(limit: number): Promise<Array<{ orderNumber: string; areaSlug: string; areaLabel: string; area: AreaInput }>> {
    const orders = (await db.execute(sql`
      select order_number, delivery_area, delivery_location->>'district' as district
      from orders order by created_at desc limit ${limit}`)) as unknown as Array<{
      order_number: string;
      delivery_area: string | null;
      district: string | null;
    }>;
    const out: Array<{ orderNumber: string; areaSlug: string; areaLabel: string; area: AreaInput }> = [];
    for (const o of orders) {
      const resolved = await this.resolver.forOrderLocation({
        deliveryArea: o.delivery_area,
        district: o.district,
      });
      if (!resolved) continue;
      out.push({
        orderNumber: o.order_number,
        areaSlug: resolved.input.areaSlug,
        areaLabel: resolved.label,
        area: resolved.input,
      });
    }
    return out;
  }
}
