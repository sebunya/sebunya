import { count, desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { deliveryProofPhotos, fulfilmentDeliveries } from '../db/schema/fulfilment';
import type { DeliveryProofPhotoRow, IDeliveryProofPhotoRepository } from '../../application/use-cases/fulfilment/DeliveryProofPhotoUseCases';

export class DrizzleDeliveryProofPhotoRepository implements IDeliveryProofPhotoRepository {
  async latestDelivery(taskId: string): Promise<{ id: string; orderId: string } | null> {
    const [row] = await db.select({ id: fulfilmentDeliveries.id, orderId: fulfilmentDeliveries.orderId })
      .from(fulfilmentDeliveries).where(eq(fulfilmentDeliveries.fulfilmentTaskId, taskId))
      .orderBy(desc(fulfilmentDeliveries.attempt)).limit(1);
    return row ?? null;
  }

  async countForDelivery(deliveryId: string): Promise<number> {
    const [row] = await db.select({ n: count() }).from(deliveryProofPhotos).where(eq(deliveryProofPhotos.deliveryId, deliveryId));
    return Number(row?.n ?? 0);
  }

  async save(input: { deliveryId: string; orderId: string; uploadedBy: string | null; image: Buffer; width: number; height: number }): Promise<string> {
    const [row] = await db.insert(deliveryProofPhotos).values(input).returning({ id: deliveryProofPhotos.id });
    return row.id;
  }

  async listForTask(taskId: string): Promise<DeliveryProofPhotoRow[]> {
    return db.select({ id: deliveryProofPhotos.id, deliveryId: deliveryProofPhotos.deliveryId, attempt: fulfilmentDeliveries.attempt, createdAt: deliveryProofPhotos.createdAt })
      .from(deliveryProofPhotos)
      .innerJoin(fulfilmentDeliveries, eq(fulfilmentDeliveries.id, deliveryProofPhotos.deliveryId))
      .where(eq(fulfilmentDeliveries.fulfilmentTaskId, taskId))
      .orderBy(fulfilmentDeliveries.attempt, deliveryProofPhotos.createdAt);
  }

  async image(id: string): Promise<Buffer | null> {
    const [row] = await db.select({ image: deliveryProofPhotos.image }).from(deliveryProofPhotos).where(eq(deliveryProofPhotos.id, id)).limit(1);
    return row?.image ?? null;
  }
}
