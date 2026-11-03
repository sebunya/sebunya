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
  const conversion = rate(now.ga4.ordersInCoveredDays, now.ga4.sessions, 50);
  const prevConversion = rate(before.ga4.ordersInCoveredDays, before.ga4.sessions, 50);
  const cpo = costPerOrder(now.spendUgx, now.ordersPlaced);
  const prevCpo = costPerOrder(before.spendUgx, before.ordersPlaced);
  const critical: Array<{ key: string; label: string; unit: 'rate' | 'UGX'; value: number | null; previousValue: number | null; state: string; goal: number | null; verdict: GoalVerdict; lowerIsBetter: boolean; rule: string }> = [
    { key: 'cart_abandonment', label: 'Cart abandonment', unit: 'rate', value: split.cart.value, previousValue: prevSplit.cart.value, state: split.cart.comparable ? split.cart.state : 'NOT_COMPARABLE', goal: pct(goal('goal_cart_abandonment_pct')), verdict: goalVerdict(split.cart.value, pct(goal('goal_cart_abandonment_pct')), true), lowerIsBetter: true, rule: '1 − checkouts started ÷ carts with items' },
    { key: 'checkout_abandonment', label: 'Checkout abandonment', unit: 'rate', value: split.checkout.value, previousValue: prevSplit.checkout.value, state: split.checkout.comparable ? split.checkout.state : 'NOT_COMPARABLE', goal: pct(goal('goal_checkout_abandonment_pct')), verdict: goalVerdict(split.checkout.value, pct(goal('goal_checkout_abandonment_pct')), true), lowerIsBetter: true, rule: '1 − orders placed ÷ checkouts started' },
    { key: 'session_conversion', label: 'Session conversion', unit: 'rate', value: conversion.value, previousValue: prevConversion.value, state: now.ga4.daysCovered === 0 ? 'NO_DATA' : conversion.state, goal: pct(goal('goal_conversion_pct')), verdict: goalVerdict(conversion.value, pct(goal('goal_conversion_pct')), false), lowerIsBetter: false, rule: `orders placed ÷ GA4 sessions, on the ${now.ga4.daysCovered} GA4-covered days` },
    { key: 'cost_per_order', label: 'Cost per order', unit: 'UGX', value: cpo.value, previousValue: prevCpo.value, state: cpo.state, goal: goal('goal_cost_per_order_ugx'), verdict: goalVerdict(cpo.value, goal('goal_cost_per_order_ugx'), true), lowerIsBetter: true, rule: 'media spend ÷ orders placed' },
  ];
  const alarmPct = goal(DIRECT_TRAFFIC_ALARM_KEY) ?? 30;
  const micro = microConversions(now.micro, before.micro, values);
  const direct = directTrafficVerdict(now.ga4.directSessions, now.ga4.sessions, alarmPct);
  // Kaushik's action dashboard: every measure that missed its goal names what to do next, in one line.
  const actions: Array<{ key: string; text: string; href: string }> = [];
  const missed = (key: string) => critical.find((c) => c.key === key)?.verdict === 'MISSED';
  if (missed('cart_abandonment')) actions.push({ key: 'cart_abandonment', text: 'Cart abandonment missed its goal: shoppers fill a basket and leave before checkout. Check the delivery fee shown in the basket, the price against the finder, and the basket reminder send log.', href: '/admin/analytics/outcomes' });
  if (missed('checkout_abandonment')) actions.push({ key: 'checkout_abandonment', text: 'Checkout abandonment missed its goal: checkouts start and do not become orders. Watch Clarity recordings of the checkout page and the phone-code and payment steps first.', href: '/admin/measurement/mmm' });
  if (missed('session_conversion')) actions.push({ key: 'session_conversion', text: 'Session conversion missed its goal: compare the segments below; a channel or device far below the rest is where the visits are being wasted.', href: '/admin/analytics/outcomes' });
  if (missed('cost_per_order')) actions.push({ key: 'cost_per_order', text: 'Cost per order missed its goal: open the channel report (time decay) and the MMM holdouts before moving budget; no attribution model alone justifies the move.', href: '/admin/measurement/channel-report' });
  if (direct.state === 'HIGH') actions.push({ key: 'direct_traffic', text: `Direct traffic is ${Math.round((direct.share ?? 0) * 100)}% of sessions: tag every link the shop sends (texts, WhatsApp, printed QR) and check redirects keep the referrer.`, href: '/admin/measurement/attribution' });
  if (micro.unvalued > 0) actions.push({ key: 'micro_values', text: `${micro.unvalued} micro conversion${micro.unvalued === 1 ? ' has' : 's have'} no value yet, so the economic value shown is incomplete. Set each in Measurement settings.`, href: '/admin/measurement/mmm' });
  if (critical.every((c) => c.verdict === 'NO_GOAL')) actions.push({ key: 'goals', text: 'No goals are set, so nothing here can be met or missed. Set the four goals in Measurement settings.', href: '/admin/measurement/mmm' });
  return {
    critical,
    actions,
    funnel: { cartsWithItems: now.cartsWithItems, checkoutsStarted: now.checkoutsStarted, ordersPlaced: now.ordersPlaced, previous: { cartsWithItems: before.cartsWithItems, checkoutsStarted: before.checkoutsStarted, ordersPlaced: before.ordersPlaced } },
    whales: whales(now.paidTotalsUgx),
    journeys: {
      linkedOrders: now.journeys.length,
      ordersPlaced: now.ordersPlaced,
      coverage: now.ordersPlaced > 0 ? now.journeys.length / now.ordersPlaced : null,
      daysToPurchase: daysToPurchase(now.journeys),
      touchesToPurchase: touchesToPurchase(now.journeys.map((j) => j.touches)),
    },
    micro,
    segments: { byChannel: segmentConversion(now.ga4.byChannel), byDevice: segmentConversion(now.ga4.byDevice), daysCovered: now.ga4.daysCovered, lastDay: now.ga4.lastDay },
    directTraffic: direct,
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
