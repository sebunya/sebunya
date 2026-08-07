import { sql } from 'drizzle-orm';
import { db } from '../client';
import type { IHeroRepository, StoredHeroSlide } from '../../../application/ports/IHeroRepository';
import type { HeroSettingsSeed, HeroSlideSeed, HeroMedia, HeroTheme, HeroTint } from '../../../domain/hero/HeroSlideLibrary';

const rowsOf = (result: any): any[] => (Array.isArray(result) ? result : result?.rows ?? []);

const toSlide = (row: any): StoredHeroSlide => ({
  id: String(row.id),
  slideKey: String(row.slide_key),
  position: Number(row.position),
  enabled: Boolean(row.enabled),
  theme: String(row.theme) as HeroTheme,
  tint: String(row.tint) as HeroTint,
  media: String(row.media) as HeroMedia,
  kicker: String(row.kicker ?? ''),
  headline: String(row.headline ?? ''),
  subcopy: String(row.subcopy ?? ''),
  ctaLabel: String(row.cta_label ?? ''),
  ctaUrl: String(row.cta_url ?? ''),
  finePrint: String(row.fine_print ?? ''),
  imageUrl: String(row.image_url ?? ''),
  imageAlt: String(row.image_alt ?? ''),
  priority: Number(row.priority ?? 0),
  extras: typeof row.extras === 'object' && row.extras !== null ? row.extras : {},
  updatedAt: new Date(row.updated_at),
});

const toSettings = (row: any): HeroSettingsSeed => ({
  slidesShown: Number(row?.slides_shown ?? 4),
  dwellMs: Number(row?.dwell_ms ?? 6000),
  autoplay: row?.autoplay === undefined ? true : Boolean(row.autoplay),
});

export class DrizzleHeroRepository implements IHeroRepository {
  async listAll(): Promise<StoredHeroSlide[]> {
    const rows = rowsOf(await db.execute(sql`select * from hero_slides order by position, slide_key`));
    return rows.map(toSlide);
  }

  async listEnabled(): Promise<StoredHeroSlide[]> {
    const rows = rowsOf(await db.execute(sql`select * from hero_slides where enabled = true order by position, slide_key`));
    return rows.map(toSlide);
  }

  async getSettings(): Promise<HeroSettingsSeed> {
    const rows = rowsOf(await db.execute(sql`select * from hero_settings where id = true limit 1`));
    return toSettings(rows[0]);
  }

  async updateSlide(slideKey: string, patch: Partial<HeroSlideSeed>, actorId: string): Promise<StoredHeroSlide | null> {
    // Build the SET list from only the fields the caller supplied. slide_key is
    // never in it — the key is locked.
    const sets: ReturnType<typeof sql>[] = [];
    const push = (col: string, value: unknown) => sets.push(sql`${sql.raw(col)} = ${value as never}`);

    if (patch.enabled !== undefined) push('enabled', patch.enabled);
    if (patch.theme !== undefined) push('theme', patch.theme);
    if (patch.tint !== undefined) push('tint', patch.tint);
    if (patch.media !== undefined) push('media', patch.media);
    if (patch.position !== undefined) push('position', patch.position);
    if (patch.priority !== undefined) push('priority', patch.priority);
    if (patch.kicker !== undefined) push('kicker', patch.kicker);
    if (patch.headline !== undefined) push('headline', patch.headline);
    if (patch.subcopy !== undefined) push('subcopy', patch.subcopy);
    if (patch.ctaLabel !== undefined) push('cta_label', patch.ctaLabel);
    if (patch.ctaUrl !== undefined) push('cta_url', patch.ctaUrl);
    if (patch.finePrint !== undefined) push('fine_print', patch.finePrint);
    if (patch.imageUrl !== undefined) push('image_url', patch.imageUrl);
    if (patch.imageAlt !== undefined) push('image_alt', patch.imageAlt);
    // jsonb: pass the RAW object through ::jsonb — the double-encoding fix.
    if (patch.extras !== undefined) sets.push(sql`extras = ${patch.extras as never}::jsonb`);

    sets.push(sql`updated_by = ${actorId}::uuid`);
    sets.push(sql`updated_at = now()`);

    const rows = rowsOf(
      await db.execute(sql`update hero_slides set ${sql.join(sets, sql`, `)} where slide_key = ${slideKey} returning *`),
    );
    return rows.length > 0 ? toSlide(rows[0]) : null;
  }

  async updateSettings(patch: Partial<HeroSettingsSeed>, actorId: string): Promise<HeroSettingsSeed> {
    const sets: ReturnType<typeof sql>[] = [];
    if (patch.slidesShown !== undefined) sets.push(sql`slides_shown = ${patch.slidesShown}`);
    if (patch.dwellMs !== undefined) sets.push(sql`dwell_ms = ${patch.dwellMs}`);
    if (patch.autoplay !== undefined) sets.push(sql`autoplay = ${patch.autoplay}`);
    sets.push(sql`updated_by = ${actorId}::uuid`);
    sets.push(sql`updated_at = now()`);
    const rows = rowsOf(
      await db.execute(sql`update hero_settings set ${sql.join(sets, sql`, `)} where id = true returning *`),
    );
    return toSettings(rows[0]);
  }

  async seedMissing(slides: readonly HeroSlideSeed[], settings: HeroSettingsSeed): Promise<{ inserted: number }> {
    await db.execute(sql`
      insert into hero_settings (id, slides_shown, dwell_ms, autoplay)
      values (true, ${settings.slidesShown}, ${settings.dwellMs}, ${settings.autoplay})
      on conflict (id) do nothing
    `);

    let inserted = 0;
    for (const s of slides) {
      const result = rowsOf(
        await db.execute(sql`
          insert into hero_slides
            (slide_key, position, enabled, theme, tint, media, kicker, headline, subcopy,
             cta_label, cta_url, fine_print, image_url, image_alt, priority, extras)
          values
            (${s.slideKey}, ${s.position}, ${s.enabled}, ${s.theme}, ${s.tint}, ${s.media},
             ${s.kicker}, ${s.headline}, ${s.subcopy}, ${s.ctaLabel}, ${s.ctaUrl}, ${s.finePrint},
             ${s.imageUrl}, ${s.imageAlt}, ${s.priority}, ${s.extras as never}::jsonb)
          on conflict (slide_key) do nothing
          returning id
        `),
      );
      if (result.length > 0) inserted += 1;
    }
    return { inserted };
  }
}
