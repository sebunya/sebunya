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
