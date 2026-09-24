import { db } from '../../../infrastructure/db/client';
import { outboxEvents } from '../../../infrastructure/db/schema/system';
import { logger } from '../../../infrastructure/logging/logger';
import type { CanonicalTelemetryEvent, BrowserTelemetryEvent } from '@goldplus/shared';

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
    // No per-event write to first_party_identities (owner decision
    // 2026-09-24): nothing reads that table since purchases moved to the
    // delivery service, and every beacon ran a sequential scan plus an UPDATE
    // on it. Click ids are still stitched by /telemetry/identity when a page
    // actually carries one.

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
      // Not awaited: the outbox row above is durable and the batch sweep delivers
      // it if this job never lands. Awaiting it held every beacon's request open
      // for as long as Redis was down.
      void QueueService.getInstance()
        .enqueue(QUEUES.TELEMETRY_DISPATCH, `browser-dispatch:${event.event_id}`, { outboxId }, outboxId)
        .catch((err) => logger.warn({ err, outboxId }, '[Telemetry] dispatch enqueue failed; the outbox sweep will deliver it'));
    }
  }
}
