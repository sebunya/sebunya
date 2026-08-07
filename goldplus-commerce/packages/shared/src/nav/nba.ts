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
  /** Sunday in Kampala */
  sunday: boolean;
  /** the flash sale is still running */
  saleLive: boolean;
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
  flash: '/shop?promo=flash-sale',
  verify: '/verification',
  all: '/shop',
};

/**
 * The applicable candidates for this visitor, unsorted. The caller (or the
 * browser engine) filters dismissed ids, sorts by score, and shows the top one.
 */
export function computeNbaCandidates(ctx: NbaContext): NbaItem[] {
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
        ? 'Only <em>' + ctx.minsToCutoff + ' minutes</em> left &mdash; check out and it arrives today'
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
      text: 'Your basket is waiting &mdash; order now for <b>' + (ctx.sunday ? 'Monday' : 'tomorrow') + ' morning</b>',
      short: 'Basket saved &mdash; arrives <b>' + (ctx.sunday ? 'Monday' : 'tomorrow') + '</b>',
      cta: 'Finish order', href: R.cart,
    });
  }

  if (ctx.signedIn && ctx.points >= 1000) {
    c.push({
      id: 'points', score: 88,
      text: 'You have <em>' + ctx.points.toLocaleString('en-UG') + ' points</em> &mdash; that is ' + money(ctx.points * 10) + ' off',
      short: '<em>' + money(ctx.points * 10) + '</em> in points to spend',
      cta: 'Spend them', href: R.rewards,
    });
  }
  if (ctx.signedIn && ctx.lastOrderDays !== null && ctx.lastOrderDays > 150) {
    c.push({
      id: 'reorder', score: 84,
      text: 'Phone battery fading? Yours is <b>' + Math.round(ctx.lastOrderDays / 30) + ' months</b> old',
      short: 'Your battery is <b>' + Math.round(ctx.lastOrderDays / 30) + ' months</b> old',
      cta: 'Find your model', href: R.batteries,
    });
  }
  if (ctx.signedIn) {
    c.push({ id: 'refer', score: 62, text: 'Send a friend here &mdash; they save <em>10%</em>, you earn <em>10%</em>', short: 'They save <em>10%</em>, you earn <em>10%</em>', cta: 'Get your link', href: R.refer });
  }

  // not signed in: the useful, honest defaults
  if (!ctx.signedIn && ctx.visits <= 1) {
    c.push({ id: 'welcome', score: 92, text: '<em>10% off</em> your first order is reserved &mdash; about <b>UGX 18,500</b> back', short: '<em>10% off</em> your first order, reserved', cta: 'Claim it', href: R.register });
  }
  if (!ctx.signedIn && ctx.visits > 1) {
    c.push({ id: 'signup', score: 70, text: 'Your <em>10% off</em> is still reserved &mdash; your phone number is the account', short: 'Your <em>10% off</em> is still reserved', cta: 'Claim it', href: R.register });
  }

  if (ctx.saleLive) {
    c.push({ id: 'sale', score: 86, text: 'Flash sale is <em>live</em> &mdash; up to <b>40% off</b>', cta: 'See the cuts', href: R.flash });
  }

  // always available, and always true
  if (ctx.sunday) {
    c.push({ id: 'sunday', score: 40, text: 'Closed Sunday &mdash; same-day delivery resumes <b>Monday</b>', short: 'Delivery resumes <b>Monday</b>', href: R.delivery });
  } else if (ctx.beforeCutoff) {
    c.push({
      id: 'cutoff', score: ctx.minsToCutoff <= 60 ? 90 : 50, urgent: ctx.minsToCutoff <= 60,
      text: ctx.minsToCutoff <= 60
        ? 'Only <em>' + ctx.minsToCutoff + ' minutes</em> left for same-day delivery in Kampala'
        : 'Order before <b>5:00pm</b> for same-day delivery in Kampala',
      short: ctx.minsToCutoff <= 60 ? '<em>' + ctx.minsToCutoff + ' min</em> left for delivery today' : 'Order by <b>5:00pm</b> for delivery today',
      href: R.delivery,
    });
  } else {
    c.push({ id: 'aftercutoff', score: 44, text: "Today's run has left &mdash; order now for <b>tomorrow morning</b>", short: 'Next delivery run is <b>tomorrow</b>', href: R.delivery });
  }

  c.push({ id: 'verify', score: 30, text: 'Every unit is tested before it is sold', cta: 'How we verify', href: R.verify });

  return c;
}

/** Kampala is a fixed UTC+3 with no DST — derive cutoff/Sunday from any Date. */
export function kampalaCutoff(now: Date): { beforeCutoff: boolean; minsToCutoff: number; sunday: boolean } {
  const k = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const day = k.getUTCDay();
  const hour = k.getUTCHours();
  const mins = k.getUTCMinutes();
  const sunday = day === 0;
  const minsToCutoff = (17 - hour) * 60 - mins;
  const beforeCutoff = !sunday && hour < 17;
  return { beforeCutoff, minsToCutoff, sunday };
}
