/**
 * Goldie's awareness layer, the parts worth testing (2026-10-13, after the wordmark glint):
 *
 *  1. An experiment. Half of visitors get the motion (the hello glint and the hesitation glint),
 *     half get a still launcher. The admin nav report already computes click-through per NBA item,
 *     so each arm records one impression per visit and one click per visit under its own key
 *     ("goldie-launch-a" moving, "goldie-launch-b" still). Keep whichever earns its place.
 *  2. A subtitle that knows the page, in the shopper's own words. "GoldPlus shop help" promised nothing; a line that names the
 *     shopper's actual question does the work the animation was trying to do. Phrased as an offer
 *     to ask, never as a product claim.
 *  3. A hesitation detector. Motion should mean "I can help with that", so the glint fires when the
 *     shopper looks stuck, not on a clock: scrolling back up to re-read, copying text (usually a
 *     model number), or going still on the page. Once per page, a few per visit, never on task pages.
 */

export type GoldieArm = 'a' | 'b';
export const ARM_KEY = 'gp-goldie-arm';

/** The visitor's arm, kept for the visitor (localStorage), so a returning shopper stays in it. */
export function goldieArm(store: Pick<Storage, 'getItem' | 'setItem'> | null, rand: () => number = Math.random): GoldieArm {
  try {
    const kept = store?.getItem(ARM_KEY);
    if (kept === 'a' || kept === 'b') return kept;
    const arm: GoldieArm = rand() < 0.5 ? 'a' : 'b';
    store?.setItem(ARM_KEY, arm);
    return arm;
  } catch { return 'a'; }
}
/** The arm that moves. */
export const armMoves = (arm: GoldieArm) => arm === 'a';

/** The pill's second line. Longest line 26 characters, so it fits the phone pill without clipping. */
export const SUBLINE_MAX = 26;
export const DEFAULT_SUBLINE = 'Your personal shopper';
export function launcherSubline(o: { path: string; productName?: string | null; phone?: string | null; todayOpen?: boolean }): string {
  const path = o.path || '/';
  const phone = (o.phone ?? '').trim();
  const name = (o.productName ?? '').trim();
  const fit = (line: string, fallback: string) => (line.length <= SUBLINE_MAX ? line : fallback);
  // Written as the shopper's own question, so "Ask Goldie" above it never repeats the word "Ask".
  if (path.startsWith('/products/') && name) {
    if (/batter/i.test(name)) return phone ? fit(`Fits your ${phone}?`, 'Will it fit your phone?') : 'Will it fit your phone?';
    if (/charger|adapter/i.test(name)) return 'What will it charge fast?';
    if (/cable|lead/i.test(name)) return 'Will it fit your phone?';
    if (/power ?bank/i.test(name)) return 'How many charges?';
    if (/earphone|earbud|headphone|headset|speaker|bluetooth/i.test(name)) return 'Calls, music or gym?';
    if (/flash|memory|card|disk/i.test(name)) return 'Which size do you need?';
    return 'Questions on this one?';
  }
  if (path.startsWith('/phone-batteries')) return phone ? fit(`Battery for your ${phone}?`, 'Which battery fits?') : 'Which battery fits?';
  if (path.startsWith('/power/chargers')) return 'Which charger do you need?';
  if (path.startsWith('/power/power-banks')) return 'Which size do you need?';
  if (path.startsWith('/power/charging-cables')) return 'Which cable fits?';
  if (path.startsWith('/audio')) return 'Calls, music or gym?';
  if (path.startsWith('/storage')) return 'Which size do you need?';
  if (path.startsWith('/delivery') || path.startsWith('/track-order')) return o.todayOpen ? 'Can it come today?' : 'Delivery to your area?';
  return DEFAULT_SUBLINE;
}

/** Pages where a nudge gets in the way of a task (same rule as the teaser, plus the finder results). */
export const NUDGE_EXCLUDED = /^\/(checkout|cart|admin|account|orders|login|logout|auth|forgot-password|consent|preferences|offline|search|compare|product-finder|battery-finder|quote-request|bulk|dealers|review|forget-details)(\/|$)/;

export type HesitationReason = 'reread' | 'copy' | 'still';
export interface HesitationOptions {
  /** How far down (share of the page) the shopper must have read before a scroll back counts. */
  minDepth?: number;
  /** Upward scroll, in viewport heights, that counts as going back to re-read. */
  rereadViewports?: number;
  /** Quiet time on the page, with the page visible, that counts as being stuck. */
  stillMs?: number;
  /** Nothing fires before this long on the page (the hello glint has the first seconds). */
  graceMs?: number;
}

/**
 * A pure state machine: feed it scroll positions, activity, copies and clock ticks; it answers with
 * a reason the first time the shopper looks stuck on this page, and null otherwise. One per page.
 */
export function createHesitation(startedAt: number, opts: HesitationOptions = {}) {
  const minDepth = opts.minDepth ?? 0.35, rereadViewports = opts.rereadViewports ?? 0.9;
  const stillMs = opts.stillMs ?? 14000, graceMs = opts.graceMs ?? 8000;
  let fired = false, maxY = 0, maxDepth = 0, lastActive = startedAt;
  const ready = (now: number) => !fired && now - startedAt >= graceMs;
  const fire = (r: HesitationReason): HesitationReason => { fired = true; return r; };
  return {
    get fired() { return fired; },
    scroll(y: number, viewport: number, docHeight: number, now: number): HesitationReason | null {
      lastActive = now;
      maxY = Math.max(maxY, y);
      maxDepth = Math.max(maxDepth, (y + viewport) / Math.max(1, docHeight));
      if (!ready(now)) return null;
      return maxDepth >= minDepth && maxY - y >= viewport * rereadViewports ? fire('reread') : null;
    },
    activity(now: number) { lastActive = now; },
    copy(now: number): HesitationReason | null { lastActive = now; return ready(now) ? fire('copy') : null; },
    tick(now: number, visible: boolean): HesitationReason | null {
      if (!visible) { lastActive = now; return null; }
      return ready(now) && now - lastActive >= stillMs ? fire('still') : null;
    },
  };
}

/** A visit gets at most this many nudges, however many pages it reads. */
export const NUDGES_PER_VISIT = 3;
/** A tap on the launcher this soon after a nudge is credited to the nudge. */
export const NUDGE_CREDIT_MS = 20000;
