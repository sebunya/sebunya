import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Fixtures } from './helpers/fixtures';

/**
 * Ambassadors & models on REAL PostgreSQL — what unit tests (which mock the
 * port) cannot prove: the adapter's SQL against the media tables (a rendition
 * address resolves to its asset; usages are written with a uuid entity_id and
 * synced without touching anyone else's rows), and the homepage document's
 * compare-and-swap write.
 *
 * The local database may hold a real ambassadors section; everything this suite
 * changes (the homepage_content row, homepage_ambassador usages) is snapshotted
 * first and put back afterwards.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('ambassadors media + homepage document (real PostgreSQL)', () => {
  let raw: any; let media: any; let repo: any; let fx: Fixtures; let actor = '';
  const assetIds: string[] = [];
  const urls: Record<string, string> = {};
  let productUsageAsset = '';
  let savedUsages: any[] = [];
  let savedDoc: any = null;
  const person = (n: number) => `00000000-0000-4000-8000-${String(900 + n).padStart(12, '0')}`;

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('postgres')(URL as string, { max: 4, onnotice: () => undefined });
    const { DrizzleAmbassadorMedia } = await import('../../apps/api/src/infrastructure/homepage/DrizzleAmbassadorMedia');
    const { DrizzleHomepageContentRepository } = await import('../../apps/api/src/infrastructure/db/repositories/DrizzleHomepageContentRepository');
    media = new DrizzleAmbassadorMedia();
    repo = new DrizzleHomepageContentRepository();
    fx = new Fixtures(raw);
    actor = await fx.user();
    savedUsages = await raw`select asset_id, entity, entity_id, field from media_usages where entity = 'homepage_ambassador'`;
    [savedDoc] = await raw`select config, updated_by from homepage_content where id = true`;

    const tag = Date.now().toString(16).padStart(12, '0');
    for (const [i, status] of (['ACTIVE', 'ACTIVE', 'ARCHIVED'] as const).entries()) {
      const sha = `${tag}${String(i).padStart(52, '0')}`.slice(0, 64);
      const dir = `/uploads/assets/it/${sha.slice(0, 12)}${i}`;
      const [a] = await raw`insert into media_assets (filename, mime, byte_size, width, height, checksum_sha256, storage_key, url, status) values (${`amb-${i}.jpg`}, 'image/jpeg', 1000, 1200, 2000, ${sha}, ${`${dir.slice(1)}/original.jpg`}, ${`${dir}/original.jpg`}, ${status}) returning id`;
      assetIds.push(a.id);
      urls[`orig${i}`] = `${dir}/original.jpg`;
      urls[`card${i}`] = `${dir}/card.webp`;
      await raw`insert into media_asset_variants (asset_id, purpose, format, width, height, byte_size, storage_key, url) values
        (${a.id}, 'card', 'webp', 480, 800, 100, ${`${dir.slice(1)}/card.webp`}, ${`${dir}/card.webp`}),
        (${a.id}, 'pdp', 'webp', 1024, 1707, 200, ${`${dir.slice(1)}/pdp.webp`}, ${`${dir}/pdp.webp`})`;
    }
    // Another module's usage of the first asset: the ambassadors sync must never touch it.
    productUsageAsset = assetIds[0];
    await raw`insert into media_usages (asset_id, entity, entity_id, field) values (${productUsageAsset}, 'product', ${person(0)}::uuid, 'gallery')`;
  });

  afterAll(async () => {
    await raw`delete from media_usages where entity = 'homepage_ambassador'`;
    for (const u of savedUsages) await raw`insert into media_usages (asset_id, entity, entity_id, field) values (${u.asset_id}, ${u.entity}, ${u.entity_id}, ${u.field}) on conflict do nothing`;
    if (assetIds.length) {
      await raw`delete from media_usages where asset_id = any(${assetIds}::uuid[])`;
      await raw`delete from media_asset_variants where asset_id = any(${assetIds}::uuid[])`;
      await raw`delete from media_assets where id = any(${assetIds}::uuid[])`;
    }
    if (savedDoc) await raw`update homepage_content set config = ${raw.json(savedDoc.config)}, updated_by = ${savedDoc.updated_by} where id = true`;
    await fx?.cleanup();
    await raw.end();
  });

  it('resolves a photo by its original OR a rendition address, and reports archived ones', async () => {
    const byOriginal = await media.resolveByUrl(urls.orig1);
    const byRendition = await media.resolveByUrl(urls.card1);
    expect(byOriginal.assetId).toBe(assetIds[1]);
    expect(byRendition.assetId).toBe(assetIds[1]);
    expect(byRendition.variants.map((v: any) => v.purpose).sort()).toEqual(['card', 'pdp']);
    expect(byRendition.status).toBe('ACTIVE');
    expect((await media.resolveByUrl(urls.card2)).status).toBe('ARCHIVED');
    expect(await media.resolveByUrl('/uploads/assets/it/nothing-here/card.webp')).toBeNull();
  });

  it('protect adds usages with the person uuid; sync makes them exact and leaves other modules alone', async () => {
    await raw`delete from media_usages where entity = 'homepage_ambassador'`;
    await media.protect([{ personId: person(1), assetId: assetIds[0] }, { personId: person(2), assetId: assetIds[1] }]);
    await media.protect([{ personId: person(1), assetId: assetIds[0] }]); // idempotent
    const rows = async () => (await raw`select asset_id, entity_id::text as person, field from media_usages where entity = 'homepage_ambassador' order by entity_id`).map((r: any) => `${r.person}:${r.asset_id}:${r.field}`);
    expect(await rows()).toEqual([`${person(1)}:${assetIds[0]}:portrait`, `${person(2)}:${assetIds[1]}:portrait`]);

    await media.syncUsages([{ personId: person(2), assetId: assetIds[1] }]);
    expect(await rows()).toEqual([`${person(2)}:${assetIds[1]}:portrait`]);
    await media.syncUsages([]);
    expect(await rows()).toEqual([]);
    const product = await raw`select 1 from media_usages where entity = 'product' and asset_id = ${productUsageAsset}`;
    expect(product).toHaveLength(1);
  });

  it('the homepage document write is a compare-and-swap on version', async () => {
    const current = await repo.getConfig();
    const written = await repo.replaceIfVersion(current.config, actor, current.version);
    expect(written.version).toBe(current.version + 1);
    expect(await repo.replaceIfVersion(current.config, actor, current.version)).toBeNull(); // stale: nothing written
    const after = await repo.getConfig();
    expect(after.version).toBe(current.version + 1);
  });
});
