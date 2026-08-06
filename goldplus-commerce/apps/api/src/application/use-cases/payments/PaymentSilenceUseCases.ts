import { toEatParts, parseClockMinutes } from '@goldplus/shared';
import { IAuditRepository } from '../../ports/IAuditRepository';
import { CreateAuditLogUseCase } from '../audit/CreateAuditLogUseCase';

/**
 * Making the silence impossible to repeat (payments brief, 2026-08-06).
 *
 * The durable fix is not the payment code. It is that a shop taking no money
 * for months said nothing to anybody. Every green dashboard measured whether
 * the SYSTEM was up; nothing measured whether the BUSINESS was happening.
 *
 * Both mechanisms ship OFF — their windows are operator decisions — and both
 * say so when asked, rather than being silent no-ops.
 */

export interface IPaymentHealthReader {
  /** When money last actually landed: the newest completed attempt. */
  lastSuccessfulPaymentAt(): Promise<Date | null>;
  /** The four funnel counters for a window. A gap between adjacent numbers IS the outage. */
  funnel(since: Date): Promise<{
    checkoutStarted: number;
    paymentRequested: number;
    paymentSucceeded: number;
    orderPaid: number;
  }>;
}

const intFrom = (values: Record<string, string>, key: string): number | null => {
  const n = Number(values[key]);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Is `now` inside the configured EAT trading window? Unset = whole day. */
export function withinTradingHours(values: Record<string, string>, now: Date): boolean {
  const start = values.trading_hours_start_eat ? parseClockMinutes(values.trading_hours_start_eat) : null;
  const end = values.trading_hours_end_eat ? parseClockMinutes(values.trading_hours_end_eat) : null;
  if (start === null || end === null) return true;
  const p = toEatParts(now);
  const minutes = p.hour * 60 + p.minute;
  // An overnight window (22:00–06:00) is legal and wraps.
  return start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

export type SilenceCheck =
  | { state: 'off'; reason: 'window_not_configured' }
  | { state: 'outside_trading_hours' }
  | { state: 'healthy'; lastPaymentAt: Date | null }
  | { state: 'SILENT'; hoursSilent: number | null; windowHours: number; lastPaymentAt: Date | null };

/**
 * The business-health alert: no successful payment inside the window, during
 * trading hours, is an emergency even when every system is green.
 *
 * `hoursSilent: null` means NO PAYMENT HAS EVER SUCCEEDED — which is not a
 * quiet day, it is the loudest possible version of this alert, and the exact
 * state this shop was found in.
 */
export class CheckPaymentSilenceUseCase {
  constructor(
    private readonly config: { values(): Promise<Record<string, string>> },
    private readonly health: IPaymentHealthReader,
  ) {}

  async execute(now: Date = new Date()): Promise<SilenceCheck> {
    const values = await this.config.values();
    const windowHours = intFrom(values, 'payment_health_alert_hours');
    if (windowHours === null) return { state: 'off', reason: 'window_not_configured' };
    if (!withinTradingHours(values, now)) return { state: 'outside_trading_hours' };

    const last = await this.health.lastSuccessfulPaymentAt();
    if (last === null) {
      return { state: 'SILENT', hoursSilent: null, windowHours, lastPaymentAt: null };
    }
    const hoursSilent = (now.getTime() - last.getTime()) / 3_600_000;
    if (hoursSilent > windowHours) {
      return { state: 'SILENT', hoursSilent: Math.floor(hoursSilent), windowHours, lastPaymentAt: last };
    }
    return { state: 'healthy', lastPaymentAt: last };
  }
}

/**
 * The synthetic Pesapal probe: on a schedule, create a REAL provider
 * transaction and prove the whole pre-PIN path unattended — credentials, the
 * registered IPN id, SubmitOrderRequest, a rendering payment page, and the IPN
 * endpoint answering from the public internet.
 *
 * WHAT IT CANNOT PROVE, said plainly: the PIN step and the success callback,
 * which need a real wallet and a real thumb. The probe transaction is
 * abandoned and goes INVALID at the provider, exactly like an abandoned
 * customer — costing nothing.
 *
 * OFF until both its keys are set: the cadence AND the amount are operator
 * decisions (the amount appears on the provider's dashboard, so it is theirs
 * to choose, not a developer's).
 */
export class PesapalSyntheticProbeUseCase {
  constructor(
    private readonly config: { values(): Promise<Record<string, string>> },
    private readonly client: {
      submitOrderRequest(input: {
        id: string;
        currency: string;
        amount: number;
        description: string;
        callback_url: string;
        cancellation_url: string;
        notification_id: string;
        billing_address: { email_address?: string; phone_number?: string; first_name?: string; last_name?: string };
      }): Promise<{ order_tracking_id: string; redirect_url: string }>;
    },
    private readonly http: { getStatus(url: string): Promise<number>; postStatus(url: string, body: unknown): Promise<number> },
    private readonly env: { callbackUrl: string; cancellationUrl: string; ipnId: string; ipnUrl: string },
    private readonly audit: IAuditRepository,
    /** Last probe time, read from the audit trail — append-only, no new table. */
    private readonly lastProbeAt: () => Promise<Date | null>,
    private readonly alert: (message: string, detail: Record<string, unknown>) => void,
  ) {}

  async execute(now: Date = new Date()): Promise<
    | { state: 'off'; reason: 'not_configured' }
    | { state: 'not_due'; nextDueAt: Date }
    | { state: 'passed'; trackingId: string }
    | { state: 'FAILED'; stage: string; detail: string }
  > {
    const values = await this.config.values();
    const intervalHours = intFrom(values, 'synthetic_probe_interval_hours');
    const amount = intFrom(values, 'synthetic_probe_amount_ugx');
    if (intervalHours === null || amount === null) return { state: 'off', reason: 'not_configured' };

    const last = await this.lastProbeAt();
    if (last && now.getTime() - last.getTime() < intervalHours * 3_600_000) {
      return { state: 'not_due', nextDueAt: new Date(last.getTime() + intervalHours * 3_600_000) };
    }

    let stage = 'submit';
    try {
      const reference = `SYNTH-${now.getTime().toString(36)}`;
      const submitted = await this.client.submitOrderRequest({
        id: reference,
        currency: 'UGX',
        amount,
        description: 'Synthetic payment path probe — will be abandoned, do not fulfil',
        callback_url: this.env.callbackUrl,
        cancellation_url: this.env.cancellationUrl,
        notification_id: this.env.ipnId,
        billing_address: { first_name: 'Synthetic', last_name: 'Probe' },
      });

      stage = 'payment_page';
      const pageStatus = await this.http.getStatus(submitted.redirect_url);
      if (pageStatus !== 200) throw new Error(`payment page answered ${pageStatus}`);

      stage = 'ipn_reachability';
      const ipnStatus = await this.http.postStatus(this.env.ipnUrl, {
        OrderTrackingId: submitted.order_tracking_id,
        OrderMerchantReference: reference,
        OrderNotificationType: 'IPNCHANGE',
      });
      if (ipnStatus !== 200) throw new Error(`IPN endpoint answered ${ipnStatus}`);

      await new CreateAuditLogUseCase(this.audit).execute({
        actorId: null,
        action: 'PAYMENT_SYNTHETIC_PROBE',
        entity: 'payment_probe',
        entityId: submitted.order_tracking_id,
        previousState: null,
        newState: {
          result: 'passed',
          reference,
          amount,
          note: 'Proves credentials, IPN registration, submit, a rendering payment page and IPN reachability. The PIN step and the success callback need a real wallet and remain unproven by design.',
        },
      });
      return { state: 'passed', trackingId: submitted.order_tracking_id };
    } catch (e) {
      const detail = e instanceof Error ? e.message.slice(0, 300) : String(e);
      this.alert(`PAYMENT_SYNTHETIC_PROBE_FAILED at ${stage}`, { stage, detail });
      await new CreateAuditLogUseCase(this.audit).execute({
        actorId: null,
        action: 'PAYMENT_SYNTHETIC_PROBE',
        entity: 'payment_probe',
        entityId: `failed-${now.getTime()}`,
        previousState: null,
        newState: { result: 'FAILED', stage, detail },
      });
      return { state: 'FAILED', stage, detail };
    }
  }
}
