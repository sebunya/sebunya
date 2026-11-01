/**
 * Lifetime value and repeat purchase (0155). Pure arithmetic over
 * CustomerFacts. Honest by construction:
 * - a customer with no counted order is not a customer here (no row);
 * - a rate over nobody is null ("No data"), never 0%;
 * - a cohort month that has not happened yet is null, never 0%.
 */
import { CustomerFacts, classifyOrder, countedOrders } from './CustomerFacts';

const DAY_MS = 86_400_000;
/** Kampala is UTC+3 all year (no daylight saving). */
const KAMPALA_OFFSET_MS = 3 * 3_600_000;

export interface CustomerValueRow {
  canonicalCustomerId: string;
  isAccount: boolean;
  orderCount: number;
  realisedOrderCount: number;
  /** Paid or delivered orders only. */
  lifetimeValueUgx: number;
  /** Every counted order, paid or not. */
  placedValueUgx: number;
  firstOrderAt: Date;
  lastOrderAt: Date;
  secondOrderAt: Date | null;
  daysToSecondOrder: number | null;
}

export function customerValue(f: CustomerFacts): CustomerValueRow | null {
  const orders = countedOrders(f);
  if (orders.length === 0) return null;
  const realised = orders.filter((o) => classifyOrder(o).realised);
  const second = orders[1] ?? null;
  return {
    canonicalCustomerId: f.canonicalCustomerId,
    isAccount: f.accountUserId !== null,
    orderCount: orders.length,
    realisedOrderCount: realised.length,
    lifetimeValueUgx: realised.reduce((s, o) => s + o.totalUgx, 0),
    placedValueUgx: orders.reduce((s, o) => s + o.totalUgx, 0),
    firstOrderAt: orders[0].placedAt,
    lastOrderAt: orders[orders.length - 1].placedAt,
    secondOrderAt: second ? second.placedAt : null,
    daysToSecondOrder: second ? Math.floor((second.placedAt.getTime() - orders[0].placedAt.getTime()) / DAY_MS) : null,
  };
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export interface CustomerValueSummary {
  customers: number;
  repeatCustomers: number;
  /** repeatCustomers / customers; null when there are no customers. */
  repeatRate: number | null;
  totalLifetimeValueUgx: number;
  /** null when no customer has a realised order. */
  averageLifetimeValueUgx: number | null;
  medianLifetimeValueUgx: number | null;
  /** null when nobody has a second order. */
  medianDaysToSecondOrder: number | null;
  customersWithRealisedOrder: number;
}

export function summariseCustomerValue(rows: CustomerValueRow[]): CustomerValueSummary {
  const customers = rows.length;
  const repeat = rows.filter((r) => r.orderCount >= 2).length;
  const withValue = rows.filter((r) => r.realisedOrderCount > 0);
  const total = withValue.reduce((s, r) => s + r.lifetimeValueUgx, 0);
  return {
    customers,
    repeatCustomers: repeat,
    repeatRate: customers ? repeat / customers : null,
    totalLifetimeValueUgx: total,
    averageLifetimeValueUgx: withValue.length ? Math.round(total / withValue.length) : null,
    medianLifetimeValueUgx: median(withValue.map((r) => r.lifetimeValueUgx)),
    medianDaysToSecondOrder: median(rows.map((r) => r.daysToSecondOrder).filter((d): d is number => d !== null)),
    customersWithRealisedOrder: withValue.length,
  };
}

/** 'YYYY-MM' in Kampala time. */
export function kampalaMonth(d: Date): string {
  return new Date(d.getTime() + KAMPALA_OFFSET_MS).toISOString().slice(0, 7);
}

function monthIndex(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return y * 12 + (m - 1);
}

export interface CohortRow {
  cohortMonth: string;
  size: number;
  /**
   * retention[k] = share of the cohort that placed an order in month k after
   * the first-order month (k = 0 is the first month, always 1 by definition).
   * null = that month has not happened yet.
   */
  retention: (number | null)[];
  /** Customers behind each retention cell (null where the month is in the future). */
  active: (number | null)[];
}

export function cohortRetention(facts: CustomerFacts[], now: Date, maxOffsets = 12): CohortRow[] {
  const nowIdx = monthIndex(kampalaMonth(now));
  const cohorts = new Map<string, { size: number; active: number[] }>();
  for (const f of facts) {
    const orders = countedOrders(f);
    if (orders.length === 0) continue;
    const cohort = kampalaMonth(orders[0].placedAt);
    const base = monthIndex(cohort);
    const entry = cohorts.get(cohort) ?? { size: 0, active: new Array(maxOffsets + 1).fill(0) };
    entry.size += 1;
    const offsets = new Set(orders.map((o) => monthIndex(kampalaMonth(o.placedAt)) - base));
    for (const k of offsets) if (k >= 0 && k <= maxOffsets) entry.active[k] += 1;
    cohorts.set(cohort, entry);
  }
  return [...cohorts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([cohortMonth, e]) => {
      const base = monthIndex(cohortMonth);
      const active = e.active.map((n, k) => (base + k > nowIdx ? null : n));
      return {
        cohortMonth,
        size: e.size,
        active,
        retention: active.map((n) => (n === null ? null : n / e.size)),
      };
    });
}
