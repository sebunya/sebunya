import { Registry } from '../Registry';
import { logger } from '../logging/logger';

/**
 * Runs the payment reconciliation poller on a schedule.
 *
 * Cadence and thresholds are OPERATIONAL numbers, not business ones — they
 * decide how soon we ask the provider a question whose answer is always the
 * provider's, never how a payment resolves. Overridable by environment,
 * defaults recorded in docs/payments/DECISIONS.md:
 *
 *   PAYMENT_RECONCILE_INTERVAL_MINUTES  (default 10) — how often the sweep runs
 *   PAYMENT_RECONCILE_AFTER_MINUTES     (default 10) — how old an attempt must
 *     be before we ask. Comfortably above the 60–120 seconds a customer needs
 *     to find their phone and enter a PIN, so the poller never races a payment
 *     still genuinely in flight.
 *   PAYMENT_ABANDON_START_FAILURES_HOURS (default 24) — how long a
 *     no-transaction attempt sits before closing as abandoned.
 *
 * Every action inside is idempotent (settlement is replay-tolerant, abandoned
 * is terminal), so the cadence bounds staleness, never correctness — the same
 * property the loyalty sweep leans on.
 */

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

const INTERVAL_MS = envInt('PAYMENT_RECONCILE_INTERVAL_MINUTES', 10) * 60_000;
const START_DELAY_MS = 60_000;

let timer: NodeJS.Timeout | null = null;
let running = false;
/** Throttle: the silence alert repeats at most hourly while in breach. */
let lastSilenceAlertAt = 0;

async function runOnce(): Promise<void> {
  if (running) return;
  running = true;
  const registry = Registry.getInstance();
  try {
    const result = await registry.reconcilePendingPaymentsUseCase.execute(new Date());
    if (result.polled > 0 || result.abandoned > 0 || result.errors.length > 0) {
      logger.info({ ...result }, '[payment-reconcile] sweep complete');
    }
    if (result.confirmed > 0) {
      // A payment the callback missed and the poller found. Loud on purpose:
      // this is the safety net catching real money.
      logger.warn(
        { confirmed: result.confirmed },
        '[payment-reconcile] CONFIRMED payment(s) found by polling that no callback delivered — the safety net caught money',
      );
    }
  } catch (error) {
    logger.error({ err: error }, '[payment-reconcile] sweep failed');
  }
  // Each stage isolated: reconciliation failing must not stop reservations
  // expiring, and vice versa. Every stage is a no-op-with-reason while its
  // operator threshold is unset.
  try {
    const expired = await registry.expireStaleReservationsUseCase.execute(new Date());
    if (expired.released > 0) logger.warn({ ...expired }, '[payment-ops] expired reservations released stock back to sale');
  } catch (error) {
    logger.error({ err: error }, '[payment-ops] reservation expiry failed');
  }
  try {
    const abandoned = await registry.abandonStaleUnpaidOrdersUseCase.execute(new Date());
    if (abandoned.abandoned > 0 || abandoned.errors.length > 0) {
      logger.warn({ ...abandoned }, '[payment-ops] stale unpaid orders abandoned');
    }
  } catch (error) {
    logger.error({ err: error }, '[payment-ops] abandonment failed');
  }
  try {
    await registry.alertOnLedgerMismatchUseCase.execute();
  } catch (error) {
    logger.error({ err: error }, '[payment-ops] ledger mismatch scan failed');
  }
  try {
    const silence = await registry.checkPaymentSilenceUseCase.execute(new Date());
    // An alarm that is switched off looked exactly like an alarm reporting
    // health: nothing was logged either way. It says so now, and if no payment
    // has EVER succeeded it says that at error level, because no operator
    // setting is needed to know that a shop taking no money is broken.
    if (silence.state === 'off' && Date.now() - lastSilenceAlertAt > 3_600_000) {
      lastSilenceAlertAt = Date.now();
      if (silence.neverPaid) {
        logger.error(
          { reason: silence.reason },
          'ALERT PAYMENT_SILENCE — NO PAYMENT HAS EVER SUCCEEDED, and the payment health alarm is not configured. ' +
            'Set payment_health_alert_hours. Check that the provider can REACH the IPN endpoint: a WAF or bot rule ' +
            'in front of it blocks server-to-server callbacks silently.',
        );
      } else {
        logger.warn(
          { reason: silence.reason },
          '[payment-ops] payment health alarm is OFF — set payment_health_alert_hours, or a revenue outage will pass unnoticed.',
        );
      }
    }
    if (silence.state === 'SILENT' && Date.now() - lastSilenceAlertAt > 3_600_000) {
      lastSilenceAlertAt = Date.now();
      logger.error(
        { hoursSilent: silence.hoursSilent, windowHours: silence.windowHours, lastPaymentAt: silence.lastPaymentAt },
        silence.hoursSilent === null
          ? 'ALERT PAYMENT_SILENCE — NO PAYMENT HAS EVER SUCCEEDED. The shop is taking no money and every system is green.'
          : 'ALERT PAYMENT_SILENCE — no successful payment inside the configured window during trading hours.',
      );
    }
  } catch (error) {
    logger.error({ err: error }, '[payment-ops] silence check failed');
  }
  try {
    const probe = await registry.pesapalSyntheticProbeUseCase.execute(new Date());
    if (probe.state === 'passed') logger.info({ trackingId: probe.trackingId }, '[payment-ops] synthetic probe passed');
    // FAILED already alerted inside the use case.
  } catch (error) {
    logger.error({ err: error }, '[payment-ops] synthetic probe errored');
  }
  running = false;
}

export function startPaymentReconcileTicker(): void {
  if (timer) return;
  setTimeout(() => void runOnce(), START_DELAY_MS).unref?.();
  timer = setInterval(() => void runOnce(), INTERVAL_MS);
  timer.unref?.();
}

export function stopPaymentReconcileTicker(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
