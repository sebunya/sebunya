/**
 * Payment intelligence, breakdowns and bounded exception drilldowns.
 *
 * Attempt-level truth, deliberately separate from the order-level
 * `payment_success_rate`: the order metric answers "what share of orders got
 * paid", this answers "what share of provider attempts succeeded". They are
 * different denominators and the response says which is which, because
 * reporting one under the other's name is exactly how a payment problem hides.
 */

import {
  ANALYTICS_CONTRACT_VERSION,
  ANALYTICS_TIMEZONE,
  MetricState,
  resolveKampalaPeriod,
} from '@goldplus/shared';
import {
  AnalyticsFulfilmentExceptionRow,
  IAnalyticsReadRepository,
} from '../../ports/IAnalyticsReadRepository';
import { AnalyticsPeriodInput } from './CommerceAnalyticsUseCases';

/** Below this many attempts a success rate is INSUFFICIENT_EVIDENCE. */
export const PAYMENT_ATTEMPT_MINIMUM_SAMPLE = 5;
export const MAX_DRILLDOWN_ROWS = 200;

export interface PaymentIntelligenceResponse {
  contractVersion: typeof ANALYTICS_CONTRACT_VERSION;
  generatedAt: string;
  timezone: string;
  period: { startDay: string; endDay: string; days: number };
  attempts: number;
  confirmed: number;
  failed: number;
  pending: number;
  /** Statuses outside the reconciliation vocabulary. A rise means drift. */
  unrecognised: number;
  callbackReceived: number;
  ipnReceived: number;
  reconciled: number;
  attemptSuccessRate: { state: MetricState; value: number | null; denominator: string; sampleSize: number };
  callbackCompleteness: { state: MetricState; value: number | null; denominator: string; sampleSize: number };
  byStatus: { status: string; count: number }[];
  byProvider: { provider: string; attempts: number; confirmed: number; successRate: number | null }[];
  notes: string[];
}

function rateOf(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.max(0, Math.min(1, numerator / denominator));
}

function stateFor(available: boolean, denominator: number, minimum: number): MetricState {
  if (!available) return 'SOURCE_UNAVAILABLE';
  if (denominator <= 0) return 'NO_DATA';
  if (denominator < minimum) return 'INSUFFICIENT_EVIDENCE';
  return 'VALUE';
}

export class GetPaymentIntelligenceUseCase {
  constructor(private readonly repo: IAnalyticsReadRepository) {}

  async execute(input: AnalyticsPeriodInput): Promise<PaymentIntelligenceResponse> {
    const period = resolveKampalaPeriod(input);
    let available = true;
    let aggregates;
    try {
      aggregates = await this.repo.paymentAggregates(period.start, period.end);
    } catch {
      available = false;
      aggregates = {
        attempts: 0, confirmed: 0, failed: 0, pending: 0, unrecognised: 0,
        callbackReceived: 0, ipnReceived: 0, reconciled: 0, byStatus: [], byProvider: [],
      };
    }

    const notes: string[] = [
      'Attempt success rate uses payment attempts as its denominator. It is not the order-level payment_success_rate and the two can legitimately differ.',
    ];
    if (aggregates.unrecognised > 0) {
      notes.push(`${aggregates.unrecognised} attempt(s) carry a status outside the reconciliation vocabulary and are counted separately rather than assumed successful or failed.`);
    }

    return {
      contractVersion: ANALYTICS_CONTRACT_VERSION,
      generatedAt: new Date().toISOString(),
      timezone: ANALYTICS_TIMEZONE,
      period: { startDay: period.startDay, endDay: period.endDay, days: period.days },
      attempts: aggregates.attempts,
      confirmed: aggregates.confirmed,
      failed: aggregates.failed,
      pending: aggregates.pending,
      unrecognised: aggregates.unrecognised,
      callbackReceived: aggregates.callbackReceived,
      ipnReceived: aggregates.ipnReceived,
      reconciled: aggregates.reconciled,
      attemptSuccessRate: {
        state: stateFor(available, aggregates.attempts, PAYMENT_ATTEMPT_MINIMUM_SAMPLE),
        value: available ? rateOf(aggregates.confirmed, aggregates.attempts) : null,
        denominator: 'payment attempts created in the period',
        sampleSize: aggregates.attempts,
      },
      callbackCompleteness: {
        state: stateFor(available, aggregates.attempts, PAYMENT_ATTEMPT_MINIMUM_SAMPLE),
        value: available ? rateOf(aggregates.callbackReceived, aggregates.attempts) : null,
        denominator: 'payment attempts created in the period',
        sampleSize: aggregates.attempts,
      },
      byStatus: aggregates.byStatus,
      byProvider: aggregates.byProvider.map((provider) => ({
        ...provider,
        // Below the sample floor a per-provider rate is not reported at all,
        // rather than shown as a confident 0% or 100% from two attempts.
        successRate: provider.attempts >= PAYMENT_ATTEMPT_MINIMUM_SAMPLE
          ? rateOf(provider.confirmed, provider.attempts)
          : null,
      })),
      notes,
    };
  }
}

export type BreakdownDimension = 'payment_status' | 'fulfilment_status';

export interface BreakdownResponse {
  contractVersion: typeof ANALYTICS_CONTRACT_VERSION;
  generatedAt: string;
  timezone: string;
  period: { startDay: string; endDay: string; days: number };
  dimension: BreakdownDimension;
  rows: { value: string; orders: number; paidOrderValueUgx: number; share: number | null }[];
  totalOrders: number;
}

export class GetAnalyticsBreakdownUseCase {
  constructor(private readonly repo: IAnalyticsReadRepository) {}

  async execute(
    dimension: string,
    input: AnalyticsPeriodInput,
  ): Promise<{ ok: true; data: BreakdownResponse } | { ok: false; code: 'UNKNOWN_DIMENSION'; message: string }> {
    // Allowlist, not free text: the dimension names a column and must never
    // be able to reach SQL unvalidated.
    if (dimension !== 'payment_status' && dimension !== 'fulfilment_status') {
      return {
        ok: false,
        code: 'UNKNOWN_DIMENSION',
        message: "Supported dimensions: 'payment_status', 'fulfilment_status'.",
      };
    }
    const period = resolveKampalaPeriod(input);
    const rows = await this.repo.ordersByDimension(
      period.start,
      period.end,
      dimension === 'payment_status' ? 'payment_status' : 'status',
    );
    const totalOrders = rows.reduce((sum, row) => sum + row.orders, 0);
    return {
      ok: true,
      data: {
        contractVersion: ANALYTICS_CONTRACT_VERSION,
        generatedAt: new Date().toISOString(),
        timezone: ANALYTICS_TIMEZONE,
        period: { startDay: period.startDay, endDay: period.endDay, days: period.days },
        dimension,
        rows: rows.map((row) => ({
          ...row,
          share: totalOrders > 0 ? row.orders / totalOrders : null,
        })),
        totalOrders,
      },
    };
  }
}

export interface DrilldownResponse {
  contractVersion: typeof ANALYTICS_CONTRACT_VERSION;
  generatedAt: string;
  timezone: string;
  period: { startDay: string; endDay: string; days: number };
  exception: 'paid_not_processing';
  description: string;
  rowLimit: number;
  truncated: boolean;
  rows: AnalyticsFulfilmentExceptionRow[];
}

/**
 * Bounded exception drilldown. Projects order numbers and states only —
 * an analytics drilldown must route the operator into the order module, not
 * become a second place customer data can be read from.
 */
export class GetAnalyticsExceptionDrilldownUseCase {
  constructor(private readonly repo: IAnalyticsReadRepository) {}

  async execute(
    exception: string,
    input: AnalyticsPeriodInput & { limit?: number | null },
  ): Promise<{ ok: true; data: DrilldownResponse } | { ok: false; code: 'UNKNOWN_EXCEPTION'; message: string }> {
    if (exception !== 'paid_not_processing') {
      return {
        ok: false,
        code: 'UNKNOWN_EXCEPTION',
        message: "Supported exceptions: 'paid_not_processing'.",
      };
    }
    const period = resolveKampalaPeriod(input);
    const now = input.now ?? new Date();
    const limit = Math.max(1, Math.min(Number(input.limit ?? 50), MAX_DRILLDOWN_ROWS));
    const rows = await this.repo.paidNotProcessingOrders(period.start, period.end, limit, now);
    return {
      ok: true,
      data: {
        contractVersion: ANALYTICS_CONTRACT_VERSION,
        generatedAt: new Date().toISOString(),
        timezone: ANALYTICS_TIMEZONE,
        period: { startDay: period.startDay, endDay: period.endDay, days: period.days },
        exception: 'paid_not_processing',
        description: 'Orders whose payment is confirmed but which have not moved past the received state.',
        rowLimit: limit,
        truncated: rows.length === limit,
        rows,
      },
    };
  }
}
