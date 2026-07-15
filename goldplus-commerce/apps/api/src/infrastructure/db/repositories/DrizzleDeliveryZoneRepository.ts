import { db } from '../client';
import { deliveryZones } from '../schema/commerce';
import { eq, asc } from 'drizzle-orm';
import { DeliveryZone, DeliveryZoneInput, normalizeDistrict } from '../../../domain/commerce/DeliveryFee';
import { IDeliveryZoneRepository } from '../../../application/ports/IDeliveryZoneRepository';

function toDomain(row: typeof deliveryZones.$inferSelect): DeliveryZone {
  return { id: row.id, district: row.district, feeUgx: row.feeUgx, enabled: row.enabled };
}

export class DrizzleDeliveryZoneRepository implements IDeliveryZoneRepository {
  async findByDistrict(district: string): Promise<DeliveryZone | null> {
    const row = await db.query.deliveryZones.findFirst({
      where: eq(deliveryZones.district, normalizeDistrict(district)),
    });
    return row ? toDomain(row) : null;
  }

  async list(): Promise<DeliveryZone[]> {
    const rows = await db.select().from(deliveryZones).orderBy(asc(deliveryZones.district));
    return rows.map(toDomain);
  }

  async upsert(input: DeliveryZoneInput): Promise<DeliveryZone> {
    const district = normalizeDistrict(input.district);
    const [row] = await db
      .insert(deliveryZones)
      .values({ district, feeUgx: input.feeUgx, enabled: input.enabled })
      .onConflictDoUpdate({
        target: deliveryZones.district,
        set: { feeUgx: input.feeUgx, enabled: input.enabled, updatedAt: new Date() },
      })
      .returning();
    return toDomain(row);
  }

  async delete(id: string): Promise<boolean> {
    const deleted = await db.delete(deliveryZones).where(eq(deliveryZones.id, id)).returning({ id: deliveryZones.id });
    return deleted.length > 0;
  }
}
