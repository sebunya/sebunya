import type { IHeroRepository, StoredHeroSlide } from '../ports/IHeroRepository';
import {
  HERO_FALLBACK_KEY,
  HERO_SETTINGS_DEFAULT,
  HERO_SLIDE_LIBRARY,
  HERO_SELECTION_TUNING,
  selectHeroSlides,
  type HeroSettingsSeed,
  type HeroSelectionContext,
} from '../../domain/hero/HeroSlideLibrary';
import { flashSaleHasEnded, validateHeroSlide, type HeroSlideFieldErrors } from '../../domain/hero/HeroSlideValidation';

/**
 * Hero content, composed for the two audiences that read it.
 *
 * The STOREFRONT gets `getPublicPayload`: enabled slides in authored order,
 * the settings, and the engine config derived from the slides' own campaign
 * data. Guard rails apply here, not in the template — never fewer than one
 * slide (fall back to the evergreen authentic slide), and a dead CTA URL is
 * blanked so the template hides the button rather than shipping a dead link.
 *
 * The EDITOR gets `getAdminPayload`: every slide, each with its validation
 * errors and a past-sale flag, so a marketer sees what is wrong before it
 * ships.
 */

export interface HeroPublicSlide {
  slideKey: string;
  theme: string;
  tint: string;
  media: string;
  kicker: string;
  headline: string;
  subcopy: string;
  ctaLabel: string;
  ctaUrl: string;
  finePrint: string;
  imageUrl: string;
  imageAlt: string;
  priority: number;
  extras: Record<string, unknown>;
}

export interface HeroEngineConfig {
  show: number;
  dwell: number;
  autoplay: boolean;
  flashSaleEnds: string | null;
  cutoffHour: number;
  prizes: Array<{ pct: number; code: string; w: number }>;
}

export interface HeroPublicPayload {
  slides: HeroPublicSlide[];
  config: HeroEngineConfig;
}

/**
 * The per-visitor signals the personalised payload consumes. Declared here as a
 * plain structural shape so the application layer never imports the
 * infrastructure signals service — the thin route fetches the signals and passes
 * them in. The infrastructure `HeroSignals` satisfies this shape.
 */
export interface HeroPersonalisationSignals {
  visits: number;
  hasOrdered: boolean;
  categoryAffinity: Array<{ categorySlug: string; score: number }>;
  preferredProduct: { imageUrl: string; alt: string; categorySlug: string } | null;
  loyalty: { points: number; tierLabel: string; goalRemaining: number } | null;
  stockBySlug: Record<string, boolean>;
  /** First-party identity for a signed-in customer (null when anonymous). */
  customer?: { firstName: string | null; area: string | null } | null;
}

/** Presentation inputs the server cannot get from the profile: the cart, the URL and the clock. */
export interface HeroPersonalisationInput {
  cartItems: number;
  referred: boolean;
  now: Date;
  /** QA override (?gp=new|returning|regular|expired|aftercutoff), else null. */
  force?: string | null;
}

export interface HeroPersonalisedPayload extends HeroPublicPayload {
  /** slideKey of the lead (first, active) slide the storefront must render active. */
  lead: string;
  /** Product to show in the arch on product-agnostic slides, or null. */
  preferredArch: { imageUrl: string; alt: string } | null;
}

export interface HeroAdminSlide extends StoredHeroSlide {
  errors: HeroSlideFieldErrors[];
  saleEnded: boolean;
}

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export class HeroContentService {
  constructor(private readonly repo: IHeroRepository) {}

  private toPublic(s: StoredHeroSlide): HeroPublicSlide {
    // Blank a dead CTA so the template hides the button (§2.5) rather than
    // shipping href="#".
    const url = (s.ctaUrl ?? '').trim();
    const safeUrl = url && url !== '#' && (url.startsWith('/') || /^https?:\/\//i.test(url)) ? url : '';
    return {
      slideKey: s.slideKey, theme: s.theme, tint: s.tint, media: s.media,
      kicker: s.kicker, headline: s.headline, subcopy: s.subcopy,
      ctaLabel: safeUrl ? s.ctaLabel : '', ctaUrl: safeUrl,
      finePrint: s.finePrint, imageUrl: s.imageUrl, imageAlt: s.imageAlt,
      priority: s.priority, extras: s.extras,
    };
  }

  private deriveConfig(slides: StoredHeroSlide[], settings: HeroSettingsSeed): HeroEngineConfig {
    const flash = slides.find((s) => s.slideKey === 'flash');
    const sameday = slides.find((s) => s.slideKey === 'sameday');
    const scratch = slides.find((s) => s.slideKey === 'scratch');
    const prizes = Array.isArray(scratch?.extras?.prizes) ? (scratch!.extras.prizes as HeroEngineConfig['prizes']) : [];
    return {
      show: settings.slidesShown,
      dwell: settings.dwellMs,
      autoplay: settings.autoplay,
      flashSaleEnds: typeof flash?.extras?.saleEndsIso === 'string' ? (flash!.extras.saleEndsIso as string) : null,
      cutoffHour: num(sameday?.extras?.cutoffHour, 17),
      prizes,
    };
  }

  /** What the storefront renders. Never returns zero slides. */
  async getPublicPayload(): Promise<HeroPublicPayload> {
    let slides: StoredHeroSlide[];
    let settings: HeroSettingsSeed;
    try {
      [slides, settings] = await Promise.all([this.repo.listEnabled(), this.repo.getSettings()]);
    } catch {
      // The hero must never be a database outage. Fall back to the library.
      return this.libraryFallback();
    }

    if (slides.length === 0) {
      // Everything disabled → the evergreen slide, never an empty box (§2.5).
      const authentic = HERO_SLIDE_LIBRARY.find((s) => s.slideKey === HERO_FALLBACK_KEY)!;
      return {
        slides: [this.toPublic({ ...authentic, id: 'fallback', updatedAt: new Date() })],
        config: this.deriveConfig([], settings),
      };
    }

    return { slides: slides.map((s) => this.toPublic(s)), config: this.deriveConfig(slides, settings) };
  }

  /** Enabled slides + settings, falling back to the library if the DB is unreachable. */
  private async loadStored(): Promise<{ slides: StoredHeroSlide[]; settings: HeroSettingsSeed }> {
    try {
      const [slides, settings] = await Promise.all([this.repo.listEnabled(), this.repo.getSettings()]);
      if (slides.length > 0) return { slides, settings };
      // Everything disabled → the evergreen slide, never an empty box (§2.5).
      const authentic = HERO_SLIDE_LIBRARY.find((s) => s.slideKey === HERO_FALLBACK_KEY)!;
      return { slides: [{ ...authentic, id: 'fallback', updatedAt: new Date() }], settings };
    } catch {
      const slides = HERO_SLIDE_LIBRARY.filter((s) => s.enabled).map((s) => ({ ...s, id: s.slideKey, updatedAt: new Date() }));
      return { slides, settings: HERO_SETTINGS_DEFAULT };
    }
  }

  /**
   * What the storefront renders for THIS visitor — selection and enrichment done
   * on the server (2026-08-07). The browser no longer selects, fetches signals or
   * gates on consent: personalisation is a first-party feature that runs for
   * everyone. The result is per-visitor and MUST NOT be shared-cached.
   *
   * Signals come from the profile (structural param, so no infra import); the
   * cart, the referral flag and the clock come from the request. Uganda is a
   * fixed UTC+3 with no DST, so the same-day cutoff and the flash countdown are
   * evaluated in Kampala time from the server clock.
   */
  async buildPersonalisedPayload(
    signals: HeroPersonalisationSignals,
    input: HeroPersonalisationInput,
  ): Promise<HeroPersonalisedPayload> {
    const { slides: stored, settings } = await this.loadStored();
    const config = this.deriveConfig(stored, settings);

    // Visitor tier mirrors the old client counter; hasOrdered stays a separate
    // flag (the rules use both). Regular does NOT fold in hasOrdered, to avoid
    // double-counting a customer who is also a frequent visitor.
    const visits = Math.max(1, signals.visits || 1);
    const KAMPALA_OFFSET_MS = 3 * 60 * 60 * 1000;
    const kampala = new Date(input.now.getTime() + KAMPALA_OFFSET_MS);
    const hour = kampala.getUTCHours();
    const day = kampala.getUTCDay(); // 0 = Sunday
    const saleLive = config.flashSaleEnds ? input.now.getTime() < new Date(config.flashSaleEnds).getTime() : false;

    const ctx: HeroSelectionContext = {
      isNew: visits <= 1,
      isReturning: visits > 1,
      isRegular: visits >= 4,
      hasOrdered: signals.hasOrdered,
      saleLive,
      beforeCutoff: hour < config.cutoffHour && day !== 0,
      cartItems: Math.max(0, input.cartItems || 0),
      // Scratch state lives in the browser; the client still shows an already
      // revealed prize. Server-side the slide stays eligible.
      scratched: false,
      referred: input.referred,
      serverCats: signals.categoryAffinity.map((a) => a.categorySlug).filter(Boolean),
    };

    // QA overrides (?gp=…) — the same set the client used, now applied server-side.
    switch (input.force) {
      case 'new': ctx.isNew = true; ctx.isReturning = false; ctx.isRegular = false; break;
      case 'returning': ctx.isNew = false; ctx.isReturning = true; ctx.isRegular = false; break;
      case 'regular': ctx.isNew = false; ctx.isReturning = true; ctx.isRegular = true; break;
      case 'expired': ctx.saleLive = false; break;
      case 'aftercutoff': ctx.beforeCutoff = false; break;
      default: break;
    }

    const chosen = selectHeroSlides(stored, ctx, { ...HERO_SELECTION_TUNING, show: config.show });
    const safe = chosen.length > 0 ? chosen : stored.slice(0, 1);

    // Enrich the chosen slides in place: real loyalty balance, category deep-link,
    // and — for a signed-in customer — first-party PII (greet by name, name their
    // delivery area). Rendered as escaped text per-visitor; never shared-cached.
    const affinityCat = ctx.serverCats[0] ?? null;
    const firstName = (signals.customer?.firstName || '').trim().slice(0, 40) || null;
    const area = (signals.customer?.area || '').trim().slice(0, 60) || null;
    const enriched = safe.map((s) => {
      const extras = { ...(s.extras ?? {}) };
      let ctaUrl = s.ctaUrl;
      let kicker = s.kicker;
      if (s.slideKey === 'loyalty' && signals.loyalty) {
        extras.points = signals.loyalty.points;
        extras.goalLabel =
          signals.loyalty.goalRemaining > 0
            ? `${signals.loyalty.goalRemaining} to ${signals.loyalty.tierLabel}`
            : signals.loyalty.tierLabel;
      }
      if ((s.slideKey === 'range' || s.slideKey === 'newarrivals') && affinityCat && ctaUrl.startsWith('/shop')) {
        ctaUrl = `/shop?category=${encodeURIComponent(affinityCat)}`;
      }
      // PII personalisation: greet a returning customer by name; name their area.
      if (firstName && (s.slideKey === 'referral' || s.slideKey === 'loyalty')) {
        kicker = `Welcome back, ${firstName}`;
      }
      if (area && s.slideKey === 'sameday') {
        kicker = `${s.kicker} · ${area}`;
      }
      return this.toPublic({ ...s, ctaUrl, extras, kicker });
    });

    return {
      slides: enriched,
      config,
      lead: safe[0].slideKey,
      preferredArch: signals.preferredProduct
        ? { imageUrl: signals.preferredProduct.imageUrl, alt: signals.preferredProduct.alt }
        : null,
    };
  }

  private libraryFallback(): HeroPublicPayload {
    const slides = HERO_SLIDE_LIBRARY.filter((s) => s.enabled).map((s) => this.toPublic({ ...s, id: s.slideKey, updatedAt: new Date() }));
    const asStored = HERO_SLIDE_LIBRARY.map((s) => ({ ...s, id: s.slideKey, updatedAt: new Date() }));
    return { slides, config: this.deriveConfig(asStored, HERO_SETTINGS_DEFAULT) };
  }

  /** Every slide with its validation state, for the editor. */
  async getAdminPayload(): Promise<{ slides: HeroAdminSlide[]; settings: HeroSettingsSeed }> {
    const [slides, settings] = await Promise.all([this.repo.listAll(), this.repo.getSettings()]);
    return {
      slides: slides.map((s) => ({
        ...s,
        errors: validateHeroSlide(s),
        saleEnded: s.slideKey === 'flash' && s.enabled && flashSaleHasEnded(s.extras),
      })),
      settings,
    };
  }
}
