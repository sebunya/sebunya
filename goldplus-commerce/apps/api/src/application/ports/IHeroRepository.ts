import type { HeroSettingsSeed, HeroSlideSeed } from '../../domain/hero/HeroSlideLibrary';

export interface StoredHeroSlide extends HeroSlideSeed {
  id: string;
  updatedAt: Date;
}

export interface IHeroRepository {
  /** Every slide, authored order. Includes disabled ones (the editor shows all). */
  listAll(): Promise<StoredHeroSlide[]>;

  /** Only enabled slides, authored order — what the storefront renders. */
  listEnabled(): Promise<StoredHeroSlide[]>;

  getSettings(): Promise<HeroSettingsSeed>;

  updateSlide(slideKey: string, patch: Partial<HeroSlideSeed>, actorId: string): Promise<StoredHeroSlide | null>;

  updateSettings(patch: Partial<HeroSettingsSeed>, actorId: string): Promise<HeroSettingsSeed>;

  /**
   * Insert any library slides missing from the table, and ensure the settings
   * row exists. Idempotent on slide_key: an operator's edits are never
   * overwritten. Returns how many slides were newly inserted.
   */
  seedMissing(slides: readonly HeroSlideSeed[], settings: HeroSettingsSeed): Promise<{ inserted: number }>;
}
