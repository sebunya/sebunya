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
