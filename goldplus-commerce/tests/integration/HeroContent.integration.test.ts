import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HERO_SLIDE_LIBRARY, HERO_SETTINGS_DEFAULT } from '@goldplus/shared';

/**
 * Hero content (0107) against REAL PostgreSQL: the seed is idempotent and
 * never overwrites an edit, the public payload never returns zero slides or a
 * dead CTA, and jsonb extras round-trip as objects.
 */

const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('hero content on real PostgreSQL', () => {
  let pg: typeof import('../../apps/api/src/infrastructure/db/client').client;
  let repo: import('../../apps/api/src/infrastructure/db/repositories/DrizzleHeroRepository').DrizzleHeroRepository;
  let service: import('../../apps/api/src/application/hero/HeroContentService').HeroContentService;
  const actor = '00000000-0000-0000-0000-0000000000aa';

  beforeAll(async () => {
    ({ client: pg } = await import('../../apps/api/src/infrastructure/db/client'));
    const { DrizzleHeroRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleHeroRepository');
    const { HeroContentService } = await import('../../apps/api/src/application/hero/HeroContentService');
    repo = new DrizzleHeroRepository();
    service = new HeroContentService(repo);
    const { applyRecommendationMigrations } = await import('./helpers/applyRecommendationMigrations');
    await applyRecommendationMigrations(pg);
    // Clean slate for a deterministic seed assertion.
    await pg`delete from hero_slides`;
    await pg`delete from hero_settings`;
  });

  afterAll(async () => {
    await pg`delete from hero_slides`;
    await pg`delete from hero_settings`;
  });

  it('seeds the whole library once, and is a no-op the second time', async () => {
    const first = await repo.seedMissing(HERO_SLIDE_LIBRARY, HERO_SETTINGS_DEFAULT);
    expect(first.inserted).toBe(12);
    const second = await repo.seedMissing(HERO_SLIDE_LIBRARY, HERO_SETTINGS_DEFAULT);
    expect(second.inserted).toBe(0);
    expect(await repo.listAll()).toHaveLength(12);
  });

  it('never overwrites an operator edit on reseed', async () => {
    await repo.updateSlide('flash', { headline: 'Operator <em>changed</em> this' }, actor);
    await repo.seedMissing(HERO_SLIDE_LIBRARY, HERO_SETTINGS_DEFAULT);
    const flash = (await repo.listAll()).find((s) => s.slideKey === 'flash');
    expect(flash?.headline).toBe('Operator <em>changed</em> this');
  });

  it('jsonb extras round-trip as a real object, not a double-encoded string', async () => {
    await repo.updateSlide('flash', { extras: { saleEndsIso: '2999-01-01T00:00:00+03:00', savePct: 33 } }, actor);
    const [row] = await pg`select jsonb_typeof(extras) as t, extras->>'savePct' as save from hero_slides where slide_key = 'flash'`;
    expect(row.t).toBe('object');
    expect(row.save).toBe('33');
  });

  it('the public payload never returns zero slides, even with everything disabled', async () => {
    const keys = (await repo.listAll()).map((s) => s.slideKey);
    for (const k of keys) await repo.updateSlide(k, { enabled: false }, actor);
    const payload = await service.getPublicPayload();
    expect(payload.slides.length).toBeGreaterThanOrEqual(1);
    // Re-enable for the remaining tests.
    for (const k of keys) await repo.updateSlide(k, { enabled: true }, actor);
  });

  it('blanks a dead CTA so the template hides the button rather than shipping a dead link', async () => {
    // A stored "#" reaches the projection; the service must neutralise it.
    await pg`update hero_slides set cta_url = '#' where slide_key = 'range'`;
    const payload = await service.getPublicPayload();
    const range = payload.slides.find((s) => s.slideKey === 'range');
    expect(range?.ctaUrl).toBe('');
    expect(range?.ctaLabel).toBe('');
    await repo.updateSlide('range', { ctaUrl: '/shop' }, actor);
  });

  it('derives the engine config from the slides own campaign data', async () => {
    await repo.updateSlide('sameday', { extras: { cutoffHour: 16 } }, actor);
    const payload = await service.getPublicPayload();
    expect(payload.config.cutoffHour).toBe(16);
    expect(payload.config.show).toBeGreaterThanOrEqual(1);
  });
});
