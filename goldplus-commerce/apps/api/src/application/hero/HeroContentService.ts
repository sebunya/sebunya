import type { IHeroRepository, StoredHeroSlide } from '../ports/IHeroRepository';
import {
  HERO_FALLBACK_KEY,
  HERO_SETTINGS_DEFAULT,
  HERO_SLIDE_LIBRARY,
  type HeroSettingsSeed,
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
