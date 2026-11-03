import { resolveKampalaPeriod } from '@goldplus/shared';
import type { IOutcomesReader, OutcomeCounts } from '../../ports/IOutcomesReader';
import type { AnalyticsPeriodInput } from './CommerceAnalyticsUseCases';
import {
  abandonmentSplit, costPerOrder, daysToPurchase, directTrafficVerdict, goalVerdict, microConversions, rate,
  segmentConversion, touchesToPurchase, whales, DIRECT_TRAFFIC_ALARM_KEY, type GoalVerdict,
} from '../../../domain/measurement/Outcomes';
import { effectiveNumber } from '../../../domain/measurement/MeasurementConfig';

export interface MeasurementValuesPort { values(): Promise<Record<string, string>> }

export type OutcomesResponse = ReturnType<typeof buildOutcomes> & { period: { startDay: string; endDay: string; days: number; previousStartDay: string; previousEndDay: string } };

/** Pure assembly, so the page's numbers can be pinned in a test without a database. */
export function buildOutcomes(now: OutcomeCounts, before: OutcomeCounts, values: Record<string, string>) {
  const goal = (key: string): number | null => effectiveNumber(values, key);
  const pct = (n: number | null) => (n === null ? null : n / 100);
  const split = abandonmentSplit(now);
  const prevSplit = abandonmentSplit(before);
  const conversion = rate(now.ordersPlaced, now.ga4.sessions, 50);
  const prevConversion = rate(before.ordersPlaced, before.ga4.sessions, 50);
  const cpo = costPerOrder(now.spendUgx, now.ordersPlaced);
  const prevCpo = costPerOrder(before.spendUgx, before.ordersPlaced);
  const critical: Array<{ key: string; label: string; unit: 'rate' | 'UGX'; value: number | null; previousValue: number | null; state: string; goal: number | null; verdict: GoalVerdict; lowerIsBetter: boolean; rule: string }> = [
    { key: 'cart_abandonment', label: 'Cart abandonment', unit: 'rate', value: split.cart.value, previousValue: prevSplit.cart.value, state: split.cart.comparable ? split.cart.state : 'NOT_COMPARABLE', goal: pct(goal('goal_cart_abandonment_pct')), verdict: goalVerdict(split.cart.value, pct(goal('goal_cart_abandonment_pct')), true), lowerIsBetter: true, rule: '1 − checkouts started ÷ carts with items' },
    { key: 'checkout_abandonment', label: 'Checkout abandonment', unit: 'rate', value: split.checkout.value, previousValue: prevSplit.checkout.value, state: split.checkout.comparable ? split.checkout.state : 'NOT_COMPARABLE', goal: pct(goal('goal_checkout_abandonment_pct')), verdict: goalVerdict(split.checkout.value, pct(goal('goal_checkout_abandonment_pct')), true), lowerIsBetter: true, rule: '1 − orders placed ÷ checkouts started' },
    { key: 'session_conversion', label: 'Session conversion', unit: 'rate', value: conversion.value, previousValue: prevConversion.value, state: now.ga4.daysCovered === 0 ? 'NO_DATA' : conversion.state, goal: pct(goal('goal_conversion_pct')), verdict: goalVerdict(conversion.value, pct(goal('goal_conversion_pct')), false), lowerIsBetter: false, rule: 'orders placed ÷ GA4 sessions, same days' },
    { key: 'cost_per_order', label: 'Cost per order', unit: 'UGX', value: cpo.value, previousValue: prevCpo.value, state: cpo.state, goal: goal('goal_cost_per_order_ugx'), verdict: goalVerdict(cpo.value, goal('goal_cost_per_order_ugx'), true), lowerIsBetter: true, rule: 'media spend ÷ orders placed' },
  ];
  const alarmPct = goal(DIRECT_TRAFFIC_ALARM_KEY) ?? 30;
  return {
    critical,
    funnel: { cartsWithItems: now.cartsWithItems, checkoutsStarted: now.checkoutsStarted, ordersPlaced: now.ordersPlaced, previous: { cartsWithItems: before.cartsWithItems, checkoutsStarted: before.checkoutsStarted, ordersPlaced: before.ordersPlaced } },
    whales: whales(now.paidTotalsUgx),
    journeys: {
      linkedOrders: now.journeys.length,
      ordersPlaced: now.ordersPlaced,
      coverage: now.ordersPlaced > 0 ? now.journeys.length / now.ordersPlaced : null,
      daysToPurchase: daysToPurchase(now.journeys),
      touchesToPurchase: touchesToPurchase(now.journeys.map((j) => j.touches)),
    },
    micro: microConversions(now.micro, before.micro, values),
    segments: { byChannel: segmentConversion(now.ga4.byChannel), byDevice: segmentConversion(now.ga4.byDevice), daysCovered: now.ga4.daysCovered },
    directTraffic: directTrafficVerdict(now.ga4.directSessions, now.ga4.sessions, alarmPct),
  };
}

export class GetOutcomesUseCase {
  constructor(private readonly reader: IOutcomesReader, private readonly config: MeasurementValuesPort) {}

  async execute(input: AnalyticsPeriodInput): Promise<OutcomesResponse> {
    const period = resolveKampalaPeriod(input);
    const [now, before, values] = await Promise.all([
      this.reader.counts(period.start, period.end, period.startDay, period.endDay),
      this.reader.counts(period.previousStart, period.previousEnd, period.previousStartDay, period.previousEndDay),
      this.config.values(),
    ]);
    return {
      period: { startDay: period.startDay, endDay: period.endDay, days: period.days, previousStartDay: period.previousStartDay, previousEndDay: period.previousEndDay },
      ...buildOutcomes(now, before, values),
    };
  }
}
