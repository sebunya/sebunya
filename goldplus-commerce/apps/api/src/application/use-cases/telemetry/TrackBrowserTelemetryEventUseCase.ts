import { db } from '../../../infrastructure/db/client';
import { outboxEvents } from '../../../infrastructure/db/schema/system';
import { DrizzleIdentityRepository } from '../../../infrastructure/db/repositories/DrizzleIdentityRepository';
import { logger } from '../../../infrastructure/logging/logger';
import type { CanonicalTelemetryEvent, BrowserTelemetryEvent } from '@goldplus/shared';

const identityRepo = new DrizzleIdentityRepository();
const EVENT_TYPE_TELEMETRY = 'TELEMETRY_DISPATCH';

export class TrackBrowserTelemetryEventUseCase {
  async execute(
    event: BrowserTelemetryEvent,
    realIp: string,
    realUa: string,
  ): Promise<void> {
    const enrichedEvent: CanonicalTelemetryEvent = {
      ...event,
      source: 'browser',
      user_data: {
        ...event.user_data,
        ip_address: realIp,
        user_agent: realUa,
      },
    };

    // Fire-and-forget identity graph enrichment
    const fpClientId = event.user_data?.fp_client_id;
    if (fpClientId) {
      identityRepo
        .upsertByFpClientId(fpClientId, {
          fpClientId,
          userId:    event.user_data?.user_id,
          gclid:     event.user_data?.gclid,
          wbraid:    event.user_data?.wbraid,
          gbraid:    event.user_data?.gbraid,
          fbc:       event.user_data?.fbc,
          fbp:       event.user_data?.fbp,
          ttclid:    event.user_data?.ttclid,
          twclid:    event.user_data?.twclid,
          li_fat_id: event.user_data?.li_fat_id,
          epik:      event.user_data?.epik,
          ipAddress: realIp,
          userAgent: realUa,
        })
        .catch((err) => logger.warn({ err }, '[Telemetry] Identity upsert failed'));
    }

    const inserted = await db
      .insert(outboxEvents)
      .values({
        eventType:      EVENT_TYPE_TELEMETRY,
        payload:        enrichedEvent as any,
        idempotencyKey: `browser:${event.event_id}`,
        status:         'pending',
        dryRunOnly:     false,
        relatedEntity:  'telemetry',
      })
      .onConflictDoNothing({ target: outboxEvents.idempotencyKey })
      .returning({ id: outboxEvents.id });

    if (inserted.length > 0) {
      const outboxId = inserted[0].id;
      const { QueueService, QUEUES } = await import('../../../infrastructure/queues/QueueService');
      await QueueService.getInstance().enqueue(
        QUEUES.TELEMETRY_DISPATCH,
        `browser-dispatch:${event.event_id}`,
        { outboxId },
        outboxId
      );
    }
  }
}
