/**
 * Client for the dedicated Commerce Analytics API (/admin/analytics).
 *
 * The analytics page consumes this governed contract instead of downloading
 * the order ledger and recomputing metrics in the web process. When the API is
 * unavailable the page renders an explicit unavailable state — it never falls
 * back to bulk order downloads.
 */

import { apiBase, type ApiEnvelope } from './api';
import type { AnalyticsOverviewResponse } from '@goldplus/shared';


export interface CommerceAnalyticsResult {
  ok: boolean;
  status: number | null;
  message: string | null;
  data: AnalyticsOverviewResponse | null;
}

export async function getCommerceAnalyticsOverview(
  token: string,
  params: { startDate?: string | null; endDate?: string | null; days?: number | null },
): Promise<CommerceAnalyticsResult> {
  const query = new URLSearchParams();
  if (params.startDate) query.set('startDate', params.startDate);
  if (params.endDate) query.set('endDate', params.endDate);
  if (params.days) query.set('days', String(params.days));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  try {
    const response = await fetch(`${apiBase}/admin/analytics/overview${suffix}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    const envelope = await response.json().catch(() => null) as ApiEnvelope<AnalyticsOverviewResponse> | null;
    if (!response.ok || !envelope?.success) {
      return {
        ok: false,
        status: response.status,
        message: envelope?.error?.message ?? `HTTP ${response.status}`,
        data: null,
      };
    }
    return { ok: true, status: response.status, message: null, data: envelope.data as AnalyticsOverviewResponse };
  } catch (error) {
    return {
      ok: false,
      status: null,
      message: error instanceof Error ? error.message : 'Commerce Analytics API is unreachable.',
      data: null,
    };
  }
}

export interface PaymentIntelligenceResult {
  ok: boolean;
  status: number | null;
  message: string | null;
  data: any | null;
}

/** Attempt-level payment truth. Separate endpoint, separate denominator. */
export async function getPaymentIntelligence(
  token: string,
  params: { startDate?: string | null; endDate?: string | null; days?: number | null },
): Promise<PaymentIntelligenceResult> {
  const query = new URLSearchParams();
  if (params.startDate) query.set('startDate', params.startDate);
  if (params.endDate) query.set('endDate', params.endDate);
  if (params.days) query.set('days', String(params.days));
  const suffix = query.size > 0 ? `?${query.toString()}` : '';
  try {
    const response = await fetch(`${apiBase}/admin/analytics/payments${suffix}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    const envelope = await response.json().catch(() => null) as ApiEnvelope<any> | null;
    if (!response.ok || !envelope?.success) {
      return { ok: false, status: response.status, message: envelope?.error?.message ?? `HTTP ${response.status}`, data: null };
    }
    return { ok: true, status: response.status, message: null, data: envelope.data };
  } catch (error) {
    return { ok: false, status: null, message: error instanceof Error ? error.message : 'Payment intelligence is unreachable.', data: null };
  }
}

export interface SalesFunnelStep {
  key: 'viewed' | 'carted' | 'ordered' | 'paid';
  label: string;
  count: number;
  previousCount: number;
  carriedOn: number | null;
  carriedOnState: 'OK' | 'FIRST_STEP' | 'NO_DATA' | 'NOT_COMPARABLE';
  lostUgx: number | null;
  lostLabel: string | null;
}
export interface SalesFunnel {
  period: { startDay: string; endDay: string; days: number };
  steps: SalesFunnelStep[];
  placedValueUgx: number;
  paidValueUgx: number;
  leakiest: SalesFunnelStep['key'] | null;
  sources: Record<SalesFunnelStep['key'], string>;
}

/** Product page to paid order, with the money that stopped at each step (gap analysis #3). */
export async function getSalesFunnel(
  token: string,
  params: { startDate?: string | null; endDate?: string | null; days?: number | null },
): Promise<{ ok: boolean; status: number; data: SalesFunnel | null }> {
  const query = new URLSearchParams();
  if (params.startDate) query.set('startDate', params.startDate);
  if (params.endDate) query.set('endDate', params.endDate);
  if (params.days) query.set('days', String(params.days));
  try {
    const response = await fetch(`${apiBase}/admin/analytics/funnel${query.size ? `?${query}` : ''}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    const envelope = (await response.json().catch(() => null)) as ApiEnvelope<SalesFunnel> | null;
    return response.ok && envelope?.success ? { ok: true, status: response.status, data: envelope.data ?? null } : { ok: false, status: response.status, data: null };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

/** Outcomes (2026-11-03): the critical few with goals, split abandonment, whales, journeys, micro conversions, segments. */
export interface OutcomesData {
  period: { startDay: string; endDay: string; days: number; previousStartDay: string; previousEndDay: string };
  critical: Array<{ key: string; label: string; unit: 'rate' | 'UGX'; value: number | null; previousValue: number | null; state: string; goal: number | null; verdict: 'MET' | 'MISSED' | 'NO_GOAL' | 'NO_VALUE'; lowerIsBetter: boolean; rule: string }>;
  actions: Array<{ key: string; text: string; href: string }>;
  /** Set when the period reached back before telemetry was trustworthy: every count on the page starts on this day. */
  countedFrom?: string | null;
  funnel: { cartsWithItems: number; checkoutsStarted: number; ordersPlaced: number; previous: { cartsWithItems: number; checkoutsStarted: number; ordersPlaced: number } };
  whales: { thresholdUgx: number | null; averageUgx: number | null; whaleOrders: number; whaleRevenueUgx: number; paidOrders: number; paidRevenueUgx: number; revenueShare: number | null; orderShare: number | null };
  journeys: {
    linkedOrders: number; ordersPlaced: number; coverage: number | null;
    daysToPurchase: { orders: number; buckets: Array<{ bucket: string; orders: number; share: number | null }> };
    touchesToPurchase: { orders: number; buckets: Array<{ bucket: string; orders: number; share: number | null }> };
  };
  micro: { rows: Array<{ key: string; label: string; help: string; count: number; previousCount: number; valueUgx: number | null; economicValueUgx: number | null }>; totalEconomicValueUgx: number; valued: number; unvalued: number };
  segments: { byChannel: OutcomeSegment[]; byDevice: OutcomeSegment[]; daysCovered: number; lastDay: string | null };
  directTraffic: { share: number | null; directSessions: number; sessions: number; alarmPct: number; state: 'OK' | 'HIGH' | 'NO_DATA' };
}
export interface OutcomeSegment { segment: string; sessions: number; newUsers: number; totalUsers: number; purchases: number; revenueUgx: number; newShare: number | null; conversion: { value: number | null; state: string } }

export async function getOutcomes(
  token: string,
  params: { startDate?: string | null; endDate?: string | null; days?: number | null },
): Promise<{ ok: boolean; status: number; data: OutcomesData | null }> {
  const query = new URLSearchParams();
  if (params.startDate) query.set('startDate', params.startDate);
  if (params.endDate) query.set('endDate', params.endDate);
  if (params.days) query.set('days', String(params.days));
  try {
    const response = await fetch(`${apiBase}/admin/analytics/outcomes${query.size ? `?${query}` : ''}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    const envelope = (await response.json().catch(() => null)) as ApiEnvelope<OutcomesData> | null;
    return response.ok && envelope?.success ? { ok: true, status: response.status, data: envelope.data ?? null } : { ok: false, status: response.status, data: null };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}

export interface OutcomeSuggestion { key: string; label: string; unit: 'pct' | 'UGX'; current: number | null; suggested: number; confidence: 'MEASURED' | 'SHRUNK' | 'DEFAULT'; basis: string; impactUgxPerMonth: number | null; currentSetting: string | null }
export interface OutcomeSuggestions { generatedAt: string; suggestions: OutcomeSuggestion[]; facts: { paidOrders: number; aovUgx: number; marginPerPaidOrderUgx: number; costCoverage: number; daysWithSessions: number } }

export async function getOutcomeSuggestions(token: string): Promise<{ ok: boolean; status: number; data: OutcomeSuggestions | null }> {
  try {
    const response = await fetch(`${apiBase}/admin/analytics/outcomes/suggestions`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    const envelope = (await response.json().catch(() => null)) as ApiEnvelope<OutcomeSuggestions> | null;
    return response.ok && envelope?.success ? { ok: true, status: response.status, data: envelope.data ?? null } : { ok: false, status: response.status, data: null };
  } catch { return { ok: false, status: 0, data: null }; }
}

export async function adoptOutcomeSuggestions(token: string, keys: string[] | null): Promise<{ ok: boolean; status: number; adopted: number; refused: Array<{ key: string; message: string }> }> {
  try {
    const response = await fetch(`${apiBase}/admin/analytics/outcomes/adopt`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ keys }), signal: AbortSignal.timeout(30_000) });
    const envelope = (await response.json().catch(() => null)) as ApiEnvelope<{ adopted: unknown[]; refused: Array<{ key: string; message: string }> }> | null;
    return response.ok && envelope?.success ? { ok: true, status: response.status, adopted: envelope.data?.adopted.length ?? 0, refused: envelope.data?.refused ?? [] } : { ok: false, status: response.status, adopted: 0, refused: [] };
  } catch { return { ok: false, status: 0, adopted: 0, refused: [] }; }
}
