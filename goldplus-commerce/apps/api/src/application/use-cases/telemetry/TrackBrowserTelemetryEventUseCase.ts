import { db } from '../../../infrastructure/db/client';
import { outboxEvents } from '../../../infrastructure/db/schema/system';
import { DrizzleIdentityRepository } from '../../../infrastructure/db/repositories/DrizzleIdentityRepository';
import { DrizzleConsentRepository } from '../../../infrastructure/measurement/DrizzleConsentRepository';
import { measurementAuditLogs } from '../../../infrastructure/db/schema/measurement-advanced';
import { logger } from '../../../infrastructure/logging/logger';
import type { CanonicalTelemetryEvent, BrowserTelemetryEvent } from '@goldplus/shared';

const identityRepo = new DrizzleIdentityRepository();
const consentRepo = new DrizzleConsentRepository();
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

    // CONSENT FIRST. A visitor who withdrew analytics consent has a row in
    // consent_current_state saying so; this use case never asked, so their
    // events were enriched into the identity graph and queued for dispatch
    // exactly like everyone else's. The control tower's "blocked by consent"
    // count existed with nothing feeding it. A visitor with no recorded
    // decision is not blocked here: the ads dispatch is gated downstream.
    const fpClientId = event.user_data?.fp_client_id;
    const { row: consent } = await consentRepo
      .getCurrentState(fpClientId, event.user_data?.user_id)
      .catch(() => ({ row: null }));
    if (consent && consent.analyticsGranted === false) {
      await db
        .insert(measurementAuditLogs)
        .values({ entityType: 'telemetry_event', entityId: String(event.event_id ?? 'unknown').slice(0, 255), action: 'CONSENT_BLOCKED', changes: { event_name: event.event_name } })
        .catch((err) => logger.warn({ err }, '[Telemetry] consent-block audit failed'));
      return;
    }

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
