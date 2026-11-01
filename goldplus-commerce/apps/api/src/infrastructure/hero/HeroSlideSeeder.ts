import { Registry } from '../Registry';
import { HERO_SLIDE_LIBRARY, HERO_SETTINGS_DEFAULT } from '../../domain/hero/HeroSlideLibrary';
import { logger } from '../logging/logger';

/**
 * Ensure the hero library exists (2026-08-07).
 *
 * Mirrors the permission-registry sync: idempotent, add-only, safe on every
 * boot. It inserts any of the 12 slides that are missing and creates the
 * settings row, but on slide_key conflict it does NOTHING — an operator's
 * edited copy, prices or toggles are never overwritten by a redeploy. A fresh
 * or production database gets the library the first time this runs.
 *
 * Best-effort: a seeding hiccup must not stop the API booting, because the
 * storefront falls back to the in-code library if the table is empty.
 */
export async function runHeroSlideSeedAtBoot(): Promise<void> {
  try {
    const { inserted } = await Registry.getInstance().heroRepo.seedMissing(HERO_SLIDE_LIBRARY, HERO_SETTINGS_DEFAULT);
    if (inserted > 0) logger.info({ inserted }, 'HERO_SLIDES_SEEDED');
  } catch (error) {
    logger.warn({ err: error instanceof Error ? error.message : String(error) }, 'HERO_SLIDE_SEED_FAILED');
  }
}
