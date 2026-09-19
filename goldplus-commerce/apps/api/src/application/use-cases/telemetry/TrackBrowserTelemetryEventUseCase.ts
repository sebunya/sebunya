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
    gaSession: { gaSessionId: string; gaSessionNumber: number } | null = null,
  ): Promise<void> {
    const enrichedEvent: CanonicalTelemetryEvent = {
      ...event,
      source: 'browser',
      user_data: {
        ...event.user_data,
        ip_address: realIp,
        user_agent: realUa,
        // The visit's GA4 session: these events are sent to GA4 server-side.
        ...(gaSession ? { ga_session_id: gaSession.gaSessionId, ga_session_number: gaSession.gaSessionNumber } : {}),
      },
    };

    // Always recorded (owner decision 2026-09-19): measurement runs server-side
    // for every visitor. The preference centre's analytics switch governs
    // analytics COOKIES in the browser (Consent Mode), and says so; it does not
    // stop the server-side record. See docs/measurement/SERVER_SIDE_GA4.md.
    const fpClientId = event.user_data?.fp_client_id;

    // Fire-and-forget identity graph enrichment
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
