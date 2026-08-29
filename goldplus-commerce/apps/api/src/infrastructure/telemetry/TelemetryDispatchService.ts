import { db } from '../db/client';
import { telemetryDeadLetterQueue } from '../db/schema/telemetry';
import { outboxEvents } from '../db/schema/system';
import { eq, and, lte, sql, inArray } from 'drizzle-orm';
import { logger } from '../logging/logger';
import { env } from '../../config/env';
import type { CanonicalTelemetryEvent } from '@goldplus/shared';
import * as client from 'prom-client';
import crypto from 'crypto';
import { DEAD_LETTER_STATE } from '../../domain/outbox/TerminalState';

const gtmOutboundLatency = new client.Histogram({
  name: 'goldplus_gtm_outbound_latency_seconds',
  help: 'Latency of outbound telemetry dispatches to sGTM in seconds',
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});

const gtmConversionFailures = new client.Counter({
  name: 'goldplus_gtm_conversion_failures_total',
  help: 'Total failed outbound telemetry dispatches to sGTM',
  labelNames: ['status'],
});

const gtmMatchingSignals = new client.Counter({
  name: 'goldplus_gtm_matching_signals_total',
  help: 'Total matching signals enriched in telemetry events sent to sGTM',
  labelNames: ['signal_type', 'event_name'],
});

const registerMetricSafe = (m: client.Metric) => {
  try {
    client.register.registerMetric(m);
  } catch (err) {
    // Ignore already registered
  }
};

registerMetricSafe(gtmOutboundLatency);
registerMetricSafe(gtmConversionFailures);
registerMetricSafe(gtmMatchingSignals);

/**
 * PHASE 6–11 + PHASE 12 — TELEMETRY DISPATCH SERVICE
 *
 * Core dispatch engine. Reads from `outbox_events` (eventType = TELEMETRY_DISPATCH)
 * and delivers canonical events to the sGTM internal endpoint for fanout to
 * GA4, Meta CAPI, TikTok, LinkedIn, X, Pinterest.
 *
 * DESIGN INVARIANTS:
 * - Zero ad-network tokens held here — all routing through sGTM.
 * - FOR UPDATE SKIP LOCKED ensures safe concurrent operation.
 * - Exponential backoff: 30s → 5m → 15m → 1h → 6h → DLQ.
 * - DLQ write is attempted before marking the outbox row processed.
 *   If the DLQ write fails, the event remains in the outbox for manual inspection.
 * - All dispatch results are logged at appropriate log levels for Grafana.
 */

const MAX_ATTEMPTS = 5;
const BATCH_SIZE   = 50;

// Backoff schedule: index = attempt number (1-based)
const BACKOFF_MS = [
  30_000,      // Attempt 1 → retry in 30s
  300_000,     // Attempt 2 → retry in 5m
  900_000,     // Attempt 3 → retry in 15m
  3_600_000,   // Attempt 4 → retry in 1h
  21_600_000,  // Attempt 5 → retry in 6h (then DLQ)
];

export const EVENT_TYPE_TELEMETRY = 'TELEMETRY_DISPATCH';

/**
 * How long a claimed row stays off the queue while it is being dispatched.
 *
 * The same outbox row is reachable by BOTH this batch sweep and the
 * TELEMETRY_DISPATCH queue worker, and `SELECT ... FOR UPDATE` outside a
 * transaction holds its lock only for that statement. Both readers therefore
 * saw the row as unprocessed and both sent it, so a purchase could be counted
 * twice by every downstream destination. Claiming is now a conditional UPDATE
 * that moves `nextAttemptAt` forward: exactly one writer can win a row, and a
 * process that dies mid-dispatch releases it when the lease expires.
 */
export const CLAIM_LEASE_MS = 300_000;

export class TelemetryDispatchService {
  /**
   * Process one batch of pending telemetry outbox events.
   * Designed to be called by OutboxTicker on a concurrent branch (Promise.allSettled).
   */
  async processBatch(): Promise<{
    claimed: number;
    dispatched: number;
    retried: number;
    deadLettered: number;
  }> {
    const now = new Date();

    const candidates = await db
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(
        and(
          eq(outboxEvents.eventType, EVENT_TYPE_TELEMETRY),
          eq(outboxEvents.isProcessed, false),
          lte(outboxEvents.nextAttemptAt, now)
        )
      )
      .orderBy(outboxEvents.nextAttemptAt)
      .limit(BATCH_SIZE)
      .for('update', { skipLocked: true });

    if (candidates.length === 0) {
      return { claimed: 0, dispatched: 0, retried: 0, deadLettered: 0 };
    }

    // The claim itself. Re-checking nextAttemptAt inside the UPDATE is what
    // makes it exclusive: the loser of a race no longer matches the predicate.
    const rows = await db
      .update(outboxEvents)
      .set({ status: 'processing', nextAttemptAt: new Date(now.getTime() + CLAIM_LEASE_MS) })
      .where(
        and(
          inArray(outboxEvents.id, candidates.map((r) => r.id)),
          eq(outboxEvents.isProcessed, false),
          lte(outboxEvents.nextAttemptAt, now)
        )
      )
      .returning();

    if (rows.length === 0) {
      return { claimed: 0, dispatched: 0, retried: 0, deadLettered: 0 };
    }

    let dispatched   = 0;
    let retried      = 0;
    let deadLettered = 0;

    for (const row of rows) {
      const event   = row.payload as CanonicalTelemetryEvent;
      const attempt = row.attemptCount + 1;

      try {
        await this.dispatch(event);
        await db
          .update(outboxEvents)
          .set({ isProcessed: true, processedAt: new Date(), status: 'sent' })
          .where(eq(outboxEvents.id, row.id));
        dispatched++;
        logger.debug({ eventId: event.event_id, eventName: event.event_name }, '[Telemetry] Dispatched');

      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn({ eventId: event.event_id, attempt, errMsg }, '[Telemetry] Dispatch failed');

        if (attempt >= MAX_ATTEMPTS) {
          // Best-effort DLQ write — if it fails we log and still mark the row
          // as processed so it doesn't block the queue forever.
          await this.sendToDlq(row.id, event, attempt, errMsg);
          await db
            .update(outboxEvents)
            // One canonical spelling. This writer's private 'dead_lettered' made
            // its dead letters invisible to every reader in the outbox repository,
            // including the replay lookup. Existing rows keep their spelling and
            // are still read, via DEAD_LETTER_STATES.
            .set({
              isProcessed: true,
              processedAt: new Date(),
              deadLetteredAt: new Date(),
              status: DEAD_LETTER_STATE,
              lastError: errMsg,
            })
            .where(eq(outboxEvents.id, row.id));
          deadLettered++;
          logger.error({ eventId: event.event_id, attempt }, '[Telemetry] Event dead-lettered after max retries');

        } else {
          const baseDelay    = BACKOFF_MS[attempt - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
          // Jitter: stagger retries by 80% to 120% to prevent connection waves
          const delay        = Math.floor(baseDelay * (0.8 + 0.4 * Math.random()));
          const nextAttemptAt = new Date(Date.now() + delay);
          await db
            .update(outboxEvents)
            .set({
              attemptCount: sql`${outboxEvents.attemptCount} + 1`,
              lastError:    errMsg,
              nextAttemptAt,
              status:       'retrying',
            })
            .where(eq(outboxEvents.id, row.id));
          retried++;
        }
      }
    }

    return { claimed: rows.length, dispatched, retried, deadLettered };
  }

  /**
   * POST a canonical event to the sGTM internal metrics endpoint.
   *
   * We use the Docker-internal URL (env.metricsInternalUrl = http://sgtm-production:8080)
   * so this call NEVER leaves the VPS network. It never touches the public HTTPS endpoint.
   * This avoids TLS overhead, DNS round-trips, and Cloudflare rate limits.
   *
   * sGTM validates the payload and fans out to all configured destinations.
   */
  private async dispatch(event: CanonicalTelemetryEvent): Promise<void> {
    const url = `${env.metricsInternalUrl}/mp/collect`;

    // SSRF Destination Validation Guard
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();
    const configuredHost = new URL(env.metricsInternalUrl || 'http://sgtm-production:8080').hostname.toLowerCase();
    const ssrfAllowlist = ['sgtm-production', 'localhost', '127.0.0.1', configuredHost];

    if (!ssrfAllowlist.includes(hostname)) {
      throw new Error(`SSRF Block: Outbound dispatch to unauthorized host: ${hostname}`);
    }

    const start = Date.now();
    const bodyStr = JSON.stringify(event);
    // No secret, no signature. Signing with a baked-in default produced a
    // signature anyone could forge and made an unconfigured integration look
    // configured, which is exactly the "fake integration" the repo forbids.
    const hmacSecret = (process.env.GTM_HMAC_SECRET ?? '').trim();
    if (!hmacSecret) throw new Error('GTM_NOT_CONFIGURED: GTM_HMAC_SECRET is not set; telemetry dispatch is not configured.');
    const signature = crypto.createHmac('sha256', hmacSecret)
      .update(bodyStr)
      .digest('hex');

    // Track matching signals
    const ud = event.user_data;
    if (ud) {
      if (ud.hashed_email) gtmMatchingSignals.inc({ signal_type: 'email', event_name: event.event_name });
      if (ud.hashed_phone) gtmMatchingSignals.inc({ signal_type: 'phone', event_name: event.event_name });
      if (ud.fbp) gtmMatchingSignals.inc({ signal_type: 'fbp', event_name: event.event_name });
      if (ud.fbc) gtmMatchingSignals.inc({ signal_type: 'fbc', event_name: event.event_name });
      if (ud.ip_address) gtmMatchingSignals.inc({ signal_type: 'ip', event_name: event.event_name });
      if (ud.user_agent) gtmMatchingSignals.inc({ signal_type: 'ua', event_name: event.event_name });
      const hasClickId = !!(ud.gclid || ud.ttclid || ud.twclid || ud.li_fat_id || ud.epik || ud.wbraid || ud.gbraid);
      if (hasClickId) gtmMatchingSignals.inc({ signal_type: 'click_id', event_name: event.event_name });
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'X-Telemetry-Source': 'goldplus-api-worker',
          'X-Event-Id':         event.event_id,
          'X-Event-Name':       event.event_name,
          'X-Signature':        signature,
        },
        body:   bodyStr,
        signal: AbortSignal.timeout(10_000), // Hard 10s cap — never blocks the ticker
      });

      const latencySec = (Date.now() - start) / 1000;
      gtmOutboundLatency.observe(latencySec);

      if (!response.ok) {
        gtmConversionFailures.inc({ status: response.status.toString() });
        const body = await response.text().catch(() => '');
        throw new Error(`sGTM ${response.status}: ${body.slice(0, 300)}`);
      }
    } catch (err) {
      if (!(err instanceof Error && err.message.includes('sGTM'))) {
        gtmConversionFailures.inc({ status: 'network_error' });
      }
      throw err;
    }
  }

  /**
   * Write a permanently failed event to the dead letter queue.
   * The DLQ entry contains the full payload for manual replay.
   */
  private async sendToDlq(
    originalOutboxId: string,
    event: CanonicalTelemetryEvent,
    totalAttempts: number,
    failedReason: string,
  ): Promise<void> {
    try {
      await db.insert(telemetryDeadLetterQueue).values({
        originalOutboxEventId: originalOutboxId,
        eventName:             event.event_name,
        eventId:               event.event_id,
        payload:               event as any,
        totalAttempts,
        failedReason,
      });
    } catch (dlqErr) {
      // Log but do NOT rethrow — a DLQ failure must not block queue processing
      logger.error(
        { dlqErr, eventId: event.event_id },
        '[Telemetry] CRITICAL: Failed to write to DLQ — event data may be permanently lost'
      );
    }
  }
}

export const telemetryDispatcher = new TelemetryDispatchService();
