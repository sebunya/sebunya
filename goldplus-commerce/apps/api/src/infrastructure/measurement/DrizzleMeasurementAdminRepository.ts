import { db } from '../db/client';
import { consentCurrentState } from '../db/schema/consent';
import { outboxEvents } from '../db/schema/system';
import { count, eq, and } from 'drizzle-orm';
import type { MeasurementAdminRepository, ConsentBreakdown } from '../../application/ports/measurement/MeasurementAdminRepository';

export class DrizzleMeasurementAdminRepository implements MeasurementAdminRepository {
  async getConsentBreakdown(): Promise<ConsentBreakdown[]> {
    return await db.select({
      analyticsGranted: consentCurrentState.analyticsGranted,
      advertisingGranted: consentCurrentState.advertisingGranted,
      personalizationGranted: consentCurrentState.personalizationGranted,
    }).from(consentCurrentState);
  }

  async getPendingOutboxCount(): Promise<number> {
    const [pendingOutbox] = await db.select({ count: count() }).from(outboxEvents)
      .where(and(
        eq(outboxEvents.eventType, 'TELEMETRY_DISPATCH'),
        eq(outboxEvents.isProcessed, false),
      ));
    return pendingOutbox?.count ?? 0;
  }

  async enqueueTelemetryDispatch(payload: any, eventId: string): Promise<void> {
    await db.insert(outboxEvents).values({
      eventType: 'TELEMETRY_DISPATCH',
      payload,
      idempotencyKey: `dlq-replay:${eventId}:${Date.now()}`,
      status: 'pending',
      dryRunOnly: false,
    });
  }
}
