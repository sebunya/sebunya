/**
 * Hero slide selection — the ONE source of truth for WHICH slides a visitor
 * sees and in what order (made server-authoritative 2026-08-07).
 *
 * This logic used to live only in the browser engine (LIB + CONFIG). It has been
 * ported verbatim and moved here so the SERVER can personalise the hero at SSR
 * from the visitor's profile: the storefront now renders the already-chosen,
 * already-ordered slides, and the browser no longer selects, fetches signals, or
 * gates on consent. Personalisation is a first-party product feature that runs
 * for every visitor.
 *
 * Eligibility (`when`) and scoring (`score`) are keyed by the LOCKED slideKey.
 * The pool is scored, filtered by eligibility, capped per theme, filled to
 * `show`, and finally ordered by funnel stage.
 */

export interface HeroSelectionContext {
  /** first session — no prior visits and not a known customer */
  isNew: boolean;
  /** has been here before (or is a known customer) */
  isReturning: boolean;
  /** frequent visitor or a paying customer */
  isRegular: boolean;
  /** has ever placed a paid order (server profile) */
  hasOrdered: boolean;
  /** the flash sale is still running (server clock vs the campaign end) */
  saleLive: boolean;
  /** same-day cutoff not yet passed and not Sunday (server clock) */
  beforeCutoff: boolean;
  /** items in the visitor's own cart */
  cartItems: number;
  /** the visitor has already revealed a scratch prize */
  scratched: boolean;
  /** arrived via a referral link */
  referred: boolean;
  /** category-affinity slugs the profile actually browsed, strongest first */
  serverCats: string[];
}

export interface HeroSelectionTuning {
  show: number;
  themeCap: Record<string, number>;
  funnel: Record<string, number>;
  priorityWeight: number;
}

/** Defaults ported from the client engine's CONFIG. `show` is overridden by CMS settings. */
export const HERO_SELECTION_TUNING: HeroSelectionTuning = {
  show: 4,
  themeCap: { offer: 2, logistics: 1, loyalty: 1, product: 1, brand: 1, trust: 1 },
  funnel: { offer: 1, product: 2, logistics: 3, loyalty: 4, brand: 5, trust: 6 },
  priorityWeight: 0.5,
};

type HeroSelectionRule = {
  when?: (c: HeroSelectionContext) => boolean;
  score: (c: HeroSelectionContext) => number;
};

/** Per-slide eligibility + score, keyed by the LOCKED slideKey. */
export const HERO_SELECTION_RULES: Record<string, HeroSelectionRule> = {
  flash: { when: (c) => c.saleLive, score: () => 100 },
  // A confirmed customer does not need a first-visit welcome.
  welcome: { when: (c) => c.isNew && c.cartItems === 0 && !c.hasOrdered, score: () => 96 },
  // Referral resonates with anyone who has already bought, even on a fresh device.
  referral: { when: (c) => c.isReturning || c.hasOrdered, score: (c) => (c.isRegular || c.hasOrdered ? 88 : 74) },
  sameday: { score: (c) => (c.beforeCutoff ? 92 : 46) },
  fees: { score: (c) => (c.isNew ? 80 : 62) },
  ambassador: { score: (c) => (c.isNew ? 70 : 58) },
  // Real browsing affinity lifts what's new in the visitor's categories.
  newarrivals: { score: (c) => (c.isRegular ? 90 : 60) + (c.serverCats.length ? 8 : 0) },
  range: { score: (c) => (c.isNew ? 78 : 50) + (c.serverCats.length ? 6 : 0) },
  // Loyalty is the natural lead for someone who has ordered before.
  loyalty: { when: (c) => !c.isNew || c.hasOrdered, score: (c) => (c.hasOrdered ? 92 : c.isRegular ? 86 : 66) },
  scratch: { when: (c) => !c.scratched, score: (c) => (c.isReturning ? 84 : 72) },
  nostories: { score: (c) => (c.isNew ? 82 : 56) },
  authentic: { score: (c) => (c.isNew ? 76 : 44) },
};

export interface HeroSelectable {
  slideKey: string;
  theme: string;
  priority: number;
}

/**
 * Choose and order the slides for one visitor. Deterministic and pure — the
 * same context always yields the same rail, which is what makes it safe to run
 * on the server. Never returns more than `show`; returns fewer only if fewer
 * slides are eligible (the caller guarantees at least one slide exists).
 */
export function selectHeroSlides<T extends HeroSelectable>(
  slides: readonly T[],
  ctx: HeroSelectionContext,
  tuning: HeroSelectionTuning = HERO_SELECTION_TUNING,
): T[] {
  const show = Math.max(1, tuning.show);

  const pool = slides
    .map((s) => {
      const rule = HERO_SELECTION_RULES[s.slideKey];
      const eligible = rule?.when ? rule.when(ctx) : true;
      const base = rule ? rule.score(ctx) : 0;
      return { s, theme: s.theme, ok: eligible, score: base + (s.priority ?? 0) * tuning.priorityWeight };
    })
    .filter((x) => x.ok);

  pool.sort((a, b) => b.score - a.score);

  const used: Record<string, number> = {};
  const chosen: typeof pool = [];
  for (const x of pool) {
    if (chosen.length >= show) break;
    const cap = tuning.themeCap[x.theme] ?? 1;
    if ((used[x.theme] ?? 0) >= cap) continue;
    used[x.theme] = (used[x.theme] ?? 0) + 1;
    chosen.push(x);
  }
  // If eligibility left us short of `show`, fill from the pool ignoring the cap.
  for (const x of pool) {
    if (chosen.length >= show) break;
    if (!chosen.includes(x)) chosen.push(x);
  }

  chosen.sort((a, b) => (tuning.funnel[a.theme] ?? 9) - (tuning.funnel[b.theme] ?? 9));
  return chosen.map((x) => x.s);
}
