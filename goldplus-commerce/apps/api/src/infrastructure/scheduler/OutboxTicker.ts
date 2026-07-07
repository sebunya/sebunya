import { Registry } from '../Registry';
import { telemetryDispatcher } from '../telemetry/TelemetryDispatchService';
import { logger } from '../logging/logger';

let tickerHandle: NodeJS.Timeout | null = null;
let isProcessing = false;

const TICK_INTERVAL_MS = 30_000;  // 30 seconds
const JITTER_MAX_MS    = 5_000;   // Up to 5s stagger on startup

/**
 * SELF-CRITIQUE FIX: Previously, notifications and telemetry were processed
 * SEQUENTIALLY. WhatsApp/email timeouts (up to 10s × 50 events = 500s) would
 * completely starve the telemetry queue.
 *
 * Fix: Both processors run CONCURRENTLY via Promise.allSettled.
 * - If notifications fail catastrophically, telemetry still runs.
 * - If telemetry stalls (sGTM down), notifications still run.
 * - Promise.allSettled never rejects — both results are logged independently.
 *
 * The single `isProcessing` flag still prevents tick overlap correctly.
 */
async function runTick(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const registry = Registry.getInstance();

    // Run both outbox processors concurrently — isolated failure domains
    const [notifResult, telemetryResult] = await Promise.allSettled([
      registry.processOutboxBatchUseCase.execute(),
      telemetryDispatcher.processBatch(),
    ]);

    // Log notification results
    if (notifResult.status === 'fulfilled') {
      const r = notifResult.value;
      if (r.claimed > 0) {
        logger.info(
          { claimed: r.claimed, succeeded: r.succeeded, retried: r.retried, exhausted: r.exhausted },
          '[OutboxTicker] Notifications batch complete'
        );
      }
    } else {
      logger.error({ err: notifResult.reason }, '[OutboxTicker] Notifications processor threw unexpectedly');
    }

    // Log telemetry results
    if (telemetryResult.status === 'fulfilled') {
      const r = telemetryResult.value;
      if (r.claimed > 0) {
        logger.info(
          { claimed: r.claimed, dispatched: r.dispatched, retried: r.retried, dlq: r.deadLettered },
          '[OutboxTicker] Telemetry batch complete'
        );
      }
    } else {
      logger.error({ err: telemetryResult.reason }, '[OutboxTicker] Telemetry processor threw unexpectedly');
    }

  } catch (err) {
    logger.fatal({ err }, '[OutboxTicker] Unhandled exception in tick — this should not happen');
  } finally {
    isProcessing = false;
  }
}

export function startOutboxTicker(): void {
  if (process.env.DISABLE_OUTBOX_PROCESSOR === '1') {
    logger.warn('[OutboxTicker] Disabled by DISABLE_OUTBOX_PROCESSOR env flag');
    return;
  }
  if (tickerHandle) return;

  const initialDelay = Math.floor(Math.random() * JITTER_MAX_MS);
  logger.info(
    { delayMs: initialDelay, intervalMs: TICK_INTERVAL_MS },
    '[OutboxTicker] Starting — first tick in specified delay'
  );

  setTimeout(() => {
    runTick();
    tickerHandle = setInterval(runTick, TICK_INTERVAL_MS);
  }, initialDelay);
}

export function stopOutboxTicker(): void {
  if (tickerHandle) {
    clearInterval(tickerHandle);
    tickerHandle = null;
    logger.info('[OutboxTicker] Stopped');
  }
}

export async function gracefulStopOutboxTicker(maxWaitMs = 10_000): Promise<void> {
  stopOutboxTicker();
  if (!isProcessing) return;

  logger.info('[OutboxTicker] Waiting for active batch to complete before shutdown...');
  const deadline = Date.now() + maxWaitMs;

  while (isProcessing && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 100));
  }

  if (isProcessing) {
    logger.warn('[OutboxTicker] Graceful stop timed out — some events may be interrupted');
  } else {
    logger.info('[OutboxTicker] Batch completed — clean shutdown');
  }
}
