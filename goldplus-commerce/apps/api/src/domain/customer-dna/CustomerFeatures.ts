/**
 * Customer DNA — deterministic feature computation (pure domain).
 *
 * Features are computed only from real persisted inputs. When an input is absent
 * the feature is NOT_OBSERVED (never a fabricated number). Every feature carries
 * its class, source, source version, computed time and freshness.
 */

import { CustomerFeature, feature, AttributeClass } from './CustomerProfile';

export interface RawOrderSignal { totalAmountUgx: number; createdAt: Date; paymentMethod: string | null; status: string; }
export interface RawSearchSignal { zeroResult: boolean; createdAt: Date; }
export interface RawDeliverySignal { outcome: string; createdAt: Date; }

export interface RawCustomerSignals {
  sourceVersion: number;
  orders: RawOrderSignal[];
  searches: RawSearchSignal[];
  deliveries: RawDeliverySignal[];
  backorderCount: number;
  supportInteractions: number;
  cartAbandonments: number;
  loyaltyBalance: number | null;
  declaredPreferences: Record<string, unknown> | null;
}

const DAY_MS = 86_400_000;

function daysBetween(a: Date, b: Date): number {
  return Math.floor((a.getTime() - b.getTime()) / DAY_MS);
}

/** Compute the full deterministic feature set. Absent inputs yield NOT_OBSERVED. */
export function computeFeatures(signals: RawCustomerSignals, now: Date): CustomerFeature[] {
  const sv = signals.sourceVersion;
  const mk = <T>(key: string, value: T | 'NOT_OBSERVED', attributeClass: AttributeClass, source: string, staleAfterHours = 24) =>
    feature<T>({ key, value, attributeClass, source, sourceVersion: sv, computedAt: now, staleAfterHours });

  const out: CustomerFeature[] = [];
  const paidOrders = signals.orders.filter((o) => o.status !== 'cancelled');
  const orderCount = paidOrders.length;

  out.push(mk('order_count', orderCount, 'OBSERVED', 'orders'));

  if (orderCount === 0) {
    out.push(mk('lifetime_value_ugx', 'NOT_OBSERVED', 'DERIVED', 'orders'));
    out.push(mk('average_order_value_ugx', 'NOT_OBSERVED', 'DERIVED', 'orders'));
    out.push(mk('last_order_date', 'NOT_OBSERVED', 'OBSERVED', 'orders'));
    out.push(mk('days_since_last_order', 'NOT_OBSERVED', 'DERIVED', 'orders'));
    out.push(mk('purchase_frequency_per_month', 'NOT_OBSERVED', 'DERIVED', 'orders'));
  } else {
    const ltv = paidOrders.reduce((s, o) => s + o.totalAmountUgx, 0);
    const sorted = [...paidOrders].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const first = sorted[0].createdAt;
    const last = sorted[sorted.length - 1].createdAt;
    const activeDays = Math.max(1, daysBetween(now, first));
    out.push(mk('lifetime_value_ugx', ltv, 'OBSERVED', 'orders'));
    out.push(mk('average_order_value_ugx', Math.round(ltv / orderCount), 'DERIVED', 'orders'));
    out.push(mk('last_order_date', last.toISOString(), 'OBSERVED', 'orders'));
    out.push(mk('days_since_last_order', daysBetween(now, last), 'DERIVED', 'orders'));
    out.push(mk('purchase_frequency_per_month', Math.round((orderCount / activeDays) * 30 * 100) / 100, 'DERIVED', 'orders'));

    // Payment-method preference (mode of observed methods).
    const methodCounts = new Map<string, number>();
    for (const o of paidOrders) if (o.paymentMethod) methodCounts.set(o.paymentMethod, (methodCounts.get(o.paymentMethod) ?? 0) + 1);
    const topMethod = [...methodCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    out.push(mk('payment_method_preference', topMethod ?? 'NOT_OBSERVED', 'OBSERVED', 'orders'));
  }

  // Search behaviour.
  out.push(mk('search_frequency', signals.searches.length, 'OBSERVED', 'search_events'));
  out.push(mk('zero_result_search_count', signals.searches.filter((s) => s.zeroResult).length, 'OBSERVED', 'search_events'));

  // Delivery outcomes.
  if (signals.deliveries.length === 0) {
    out.push(mk('delivery_success_rate', 'NOT_OBSERVED', 'DERIVED', 'fulfilment_deliveries'));
  } else {
    const delivered = signals.deliveries.filter((d) => d.outcome === 'DELIVERED').length;
    out.push(mk('delivery_success_rate', Math.round((delivered / signals.deliveries.length) * 100) / 100, 'DERIVED', 'fulfilment_deliveries'));
  }
  out.push(mk('backorder_exposure', signals.backorderCount, 'OBSERVED', 'fulfilment_lines'));
  out.push(mk('support_interactions', signals.supportInteractions, 'OBSERVED', 'support'));
  out.push(mk('cart_abandonments', signals.cartAbandonments, 'OBSERVED', 'carts'));

  // Engagement recency (days since most recent of any signal).
  const stamps = [
    ...signals.orders.map((o) => o.createdAt),
    ...signals.searches.map((s) => s.createdAt),
    ...signals.deliveries.map((d) => d.createdAt),
  ];
  if (stamps.length === 0) out.push(mk('engagement_recency_days', 'NOT_OBSERVED', 'DERIVED', 'multi'));
  else out.push(mk('engagement_recency_days', daysBetween(now, new Date(Math.max(...stamps.map((d) => d.getTime())))), 'DERIVED', 'multi'));

  // Loyalty (only where present).
  out.push(mk('loyalty_balance', signals.loyaltyBalance ?? 'NOT_OBSERVED', 'OBSERVED', 'loyalty_ledger'));

  return out;
}

/** Extract a numeric feature value (or null if it is a truthful sentinel). */
export function numericFeature(features: CustomerFeature[], key: string): number | null {
  const f = features.find((x) => x.key === key);
  if (!f || typeof f.value !== 'number') return null;
  return f.value;
}
