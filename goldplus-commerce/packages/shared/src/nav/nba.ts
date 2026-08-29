/**
 * Next Best Action — the header strip's single most-useful message per visitor.
 *
 * Ported from the approved header's client candidate set and made SERVER-side
 * (2026-08-07): the storefront computes the ranked candidates from real signals
 * (cart, the 17:00 Kampala cutoff, sign-in, loyalty balance, order history, visit
 * tenure, the flash sale) and injects them as `window.GP_NBA`. The browser keeps
 * an identical offline set as the fallback (§3), and the static HTML carries the
 * honest default for no-JS.
 *
 * ONE source of truth, so the server list and the browser fallback never drift.
 * Copy carries only <b>/<em> and server-computed numbers — no user input — so it
 * is safe to render via innerHTML the way the engine does.
 *
 * The strip does NOT rotate. Lower-scoring candidates exist only so a dismissal
 * has somewhere to fall back to; the client filters dismissed ids, sorts by score
 * and shows the top one.
 */

export interface NbaContext {
  /** authenticated customer (server truth) */
  signedIn: boolean;
  /** visit tenure: 1 = first session, >1 = returning */
  visits: number;
  /** items in the visitor's cart */
  cart: number;
  /** real loyalty balance */
  points: number;
  /** days since the last paid order, or null */
  lastOrderDays: number | null;
  /** a live order is out for delivery today */
  orderInTransit: boolean;
  /** before the 17:00 Kampala cutoff and not Sunday */
  beforeCutoff: boolean;
  /** whole minutes to the cutoff (only meaningful when beforeCutoff) */
  minsToCutoff: number;
  /** Sunday in Kampala (kept as the back-compat "closed today" flag) */
  sunday: boolean;
  /** the flash sale is still running */
  saleLive: boolean;
  /** operator-configured cutoff label for copy, e.g. "5:00pm" (default 5:00pm) */
  cutoffLabel?: string;
}

export interface NbaItem {
  id: string;
  score: number;
  /** full copy, ≤72 visible chars; may carry <b>/<em> */
  text: string;
  /** ≤40-char variant for ≤980px; optional */
  short?: string;
  /** call-to-action label; the strip appends " →" */
  cta?: string;
  href: string;
  urgent?: boolean;
}

/**
 * The offer figures the copy quotes. CMS-owned (nav.settings) so the strip never
 * hardcodes a percentage the operator has since changed; the defaults reproduce
 * the launch copy exactly, so callers that pass nothing behave as before. The
 * browser fallback (GpNav) mirrors these from window.__GPNAV — one source, no drift.
 */
export interface NbaRates {
  /** @deprecated No first-order pricing rule exists; kept so stored configs still type-check. Unused. */
  firstOrderPct: number;
  referralPct: number;
  pointsToUgxRate: number;
  /** @deprecated See firstOrderPct. Unused. */
  firstOrderEstimate: string;
  /** The LIVE storewide promotion's percentage, or 0 when no sale runs. */
  salePct?: number;
}

export const DEFAULT_NBA_RATES: NbaRates = {
  firstOrderPct: 10,
  referralPct: 10,
  pointsToUgxRate: 10,
  firstOrderEstimate: 'UGX 18,500',
  salePct: 0,
};

const money = (n: number) => 'UGX ' + n.toLocaleString('en-UG');

/** Routes as the live storefront serves them (no Shopify /collections or /pages). */
const R = {
  delivery: '/support',
  cart: '/cart',
  rewards: '/account/rewards',
  refer: '/account/rewards',
  register: '/register',
  account: '/account',
  batteries: '/shop?category=power&q=battery',
  flash: '/shop',
  verify: '/verification',
  all: '/shop',
};

/**
 * The applicable candidates for this visitor, unsorted. The caller (or the
 * browser engine) filters dismissed ids, sorts by score, and shows the top one.
 */
export function computeNbaCandidates(ctx: NbaContext, rates: NbaRates = DEFAULT_NBA_RATES): NbaItem[] {
  const r = { ...DEFAULT_NBA_RATES, ...rates };
  const c: NbaItem[] = [];

  // signed-in: things only we can know
  if (ctx.orderInTransit) {
    c.push({ id: 'transit', urgent: true, score: 100, text: 'Your order is <b>out for delivery</b> today', cta: 'Track it', href: R.account });
  }

  // Cart beats sign-in status — an anonymous visitor with items is the highest-intent person here.
  if (ctx.cart > 0 && ctx.beforeCutoff) {
    c.push({
      id: 'cart-cutoff', score: 96,
      text: ctx.minsToCutoff <= 60
        ? 'Only <em>' + ctx.minsToCutoff + ' minutes</em> left. Check out now and we deliver today'
        : 'Check out in <b>' + Math.floor(ctx.minsToCutoff / 60) + 'h ' + (ctx.minsToCutoff % 60) + 'm</b> and it arrives today',
      short: ctx.minsToCutoff <= 60
        ? '<em>' + ctx.minsToCutoff + ' min</em> left to get it today'
        : 'Order in <b>' + Math.floor(ctx.minsToCutoff / 60) + 'h ' + (ctx.minsToCutoff % 60) + 'm</b>, arrives today',
      cta: 'Finish order', href: R.cart,
    });
  }
  if (ctx.cart > 0 && !ctx.beforeCutoff) {
    c.push({
      id: 'cart-later', score: 94,
      // Naming Monday assumed Sunday was the only closed day. The operator sets
      // which days are closed, so the copy states the rule rather than a weekday
      // that may not be the right one.
      text: 'Your basket is waiting. Order now and we deliver <b>' + (ctx.sunday ? 'on the next working day' : 'tomorrow morning') + '</b>',
      short: 'Basket saved. We deliver <b>' + (ctx.sunday ? 'next working day' : 'tomorrow') + '</b>',
      cta: 'Finish order', href: R.cart,
    });
  }

  // Only surface "spend your points" when redemption is configured (rate > 0).
  // A shilling value is never asserted for points that cannot yet be redeemed.
  if (ctx.signedIn && ctx.points >= 1000 && r.pointsToUgxRate > 0) {
    c.push({
      id: 'points', score: 88,
      text: 'You have <em>' + ctx.points.toLocaleString('en-UG') + ' points</em>. That is a ' + money(ctx.points * r.pointsToUgxRate) + ' discount',
      short: '<em>' + money(ctx.points * r.pointsToUgxRate) + '</em> in points to spend',
      cta: 'Spend them', href: R.rewards,
    });
  }
  if (ctx.signedIn && ctx.lastOrderDays !== null && ctx.lastOrderDays > 150) {
    c.push({
      id: 'reorder', score: 84,
      // The only fact we hold is the age of the last order. Never "your battery
      // is N months old": that order may not have been a battery.
      text: 'Your last order was <b>' + Math.round(ctx.lastOrderDays / 30) + ' months</b> ago. Phone battery fading?',
      short: 'Last order <b>' + Math.round(ctx.lastOrderDays / 30) + ' months</b> ago. Battery fading?',
      cta: 'Find your model', href: R.batteries,
    });
  }
  if (ctx.signedIn) {
    // The referral programme pays POINTS to both sides when the friend's first order is delivered. It never paid a percentage.
    c.push({ id: 'refer', score: 62, text: 'Introduce a friend. You both earn <em>points</em> when their first order is delivered', short: 'Introduce a friend. You both earn <em>points</em>', cta: 'Get your link', href: R.refer });
  }

  // not signed in: the useful, honest defaults. These used to promise
  // "10% off your first order is reserved — about UGX 18,500 back", from CMS
  // numbers with no pricing rule behind them. The only discount that exists
  // is the live storewide sale, and it is named below when it runs.
  if (!ctx.signedIn && ctx.visits <= 1) {
    c.push({ id: 'welcome', score: 60, text: 'Your phone number is your account. Join free and earn <em>points</em> on every paid order', short: 'Join free and earn <em>points</em> on every order', cta: 'Join free', href: R.register });
  }
  if (!ctx.signedIn && ctx.visits > 1) {
    c.push({ id: 'signup', score: 55, text: 'Join free. Your phone number is the account, and points start with your next order', short: 'Join free. Points start with your next order', cta: 'Join free', href: R.register });
  }

  // The live sale, with its real percentage. Never a typed figure: the old
  // line said "up to 40% off" for a sale that had no such cut.
  const salePct = Number(r.salePct) || 0;
  if (ctx.saleLive && salePct > 0) {
    c.push({ id: 'sale', score: 92, text: '<em>' + salePct + '% discount</em> on everything right now. It comes off at checkout', short: '<em>' + salePct + '% discount</em> on everything, on now', cta: 'Get the discount', href: R.all });
  }

  // always available, and always true
  const cutoffLabel = ctx.cutoffLabel || '5:00pm';
  if (ctx.sunday) {
    c.push({ id: 'sunday', score: 40, text: 'Closed today. Same day delivery resumes the <b>next working day</b>', short: 'Delivery resumes <b>next working day</b>', href: R.delivery });
  } else if (ctx.beforeCutoff) {
    c.push({
      id: 'cutoff', score: ctx.minsToCutoff <= 60 ? 90 : 50, urgent: ctx.minsToCutoff <= 60,
      text: ctx.minsToCutoff <= 60
        ? 'Only <em>' + ctx.minsToCutoff + ' minutes</em> left to order for delivery today'
        : 'Order before <b>' + cutoffLabel + '</b> and we deliver today in Kampala and Wakiso',
      short: ctx.minsToCutoff <= 60 ? '<em>' + ctx.minsToCutoff + ' min</em> left for delivery today' : 'Order by <b>' + cutoffLabel + '</b> for delivery today',
      href: R.delivery,
    });
  } else {
    c.push({ id: 'aftercutoff', score: 44, text: "Today's run has left. Order now and we deliver <b>tomorrow morning</b>", short: 'Next delivery run is <b>tomorrow</b>', href: R.delivery });
  }

  c.push({ id: 'verify', score: 30, text: 'Every unit is tested before it is sold', cta: 'How we verify', href: R.verify });

  return c;
}

/** Operator-editable same-day delivery window (business_info). */
export interface DeliveryCutoffConfig {
  /** Same-day order deadline, hour of day 0–23 Kampala time. Default 17 (5pm). */
  cutoffHour?: number;
  /** Weekdays with no same-day run, 0=Sun…6=Sat. Default [0] (closed Sunday). */
  closedDays?: number[];
}

/** 24h hour → "5:00pm" style label for copy. */
export function formatCutoffLabel(hour: number): string {
  const h = ((Math.trunc(hour) % 24) + 24) % 24;
  const ampm = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:00${ampm}`;
}

/**
 * Kampala is a fixed UTC+3 with no DST — derive the same-day cutoff and closed
 * state from any Date. The cutoff hour and closed days are operator-editable
 * (business_info); the defaults (17:00, closed Sunday) reproduce the original
 * behaviour so callers that pass nothing are unchanged. `sunday` is kept as a
 * back-compat alias for "closed today".
 */
export function kampalaCutoff(
  now: Date,
  cfg?: DeliveryCutoffConfig,
): { beforeCutoff: boolean; minsToCutoff: number; closed: boolean; sunday: boolean; cutoffHour: number; cutoffLabel: string } {
  const cutoffHour = Number.isFinite(cfg?.cutoffHour) ? Math.min(23, Math.max(0, Math.trunc(cfg!.cutoffHour!))) : 17;
  const closedDays = Array.isArray(cfg?.closedDays) ? cfg!.closedDays! : [0];
  const k = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const day = k.getUTCDay();
  const hour = k.getUTCHours();
  const mins = k.getUTCMinutes();
  const closed = closedDays.includes(day);
  const minsToCutoff = (cutoffHour - hour) * 60 - mins;
  const beforeCutoff = !closed && hour < cutoffHour;
  return { beforeCutoff, minsToCutoff, closed, sunday: closed, cutoffHour, cutoffLabel: formatCutoffLabel(cutoffHour) };
}
