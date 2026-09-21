import { afterAll, beforeAll, describe, expect, it } from 'vitest';
/**
 * Focus 4 — the gallery mutation service on REAL PostgreSQL (disposable
 * production copy or the local integration database). Proves what unit tests
 * cannot: migration 0148's constraints hold, the slot swap is constraint-safe,
 * two writers with the same revision cannot both win, an empty gallery can be
 * filled concurrently without a duplicate cover, the legacy projection and the
 * usage graph follow the map, and the audit row is written in the transaction.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite('product media slots (real PostgreSQL)', () => {
  let raw: any; let uc: any; let repo: any; let actor: string;
  let productId = ''; const assetIds: string[] = [];

  beforeAll(async () => {
    const { createRequire } = await import('node:module');
    raw = createRequire(import.meta.url)('postgres')(URL as string, { max: 4, onnotice: () => undefined });
    const { Registry } = await import('../../apps/api/src/infrastructure/Registry');
    uc = Registry.getInstance().productMediaUseCases;
    repo = Registry.getInstance().productMediaRepo;
    actor = (await raw`select id from users limit 1`)[0].id;
    const cat = (await raw`select id from categories limit 1`)[0].id;
    const tag = Date.now();
    productId = (await raw`insert into products (sku, model_number, name, slug, category_id, approval_status, active) values (${`ITEST-F4-${tag}`}, ${`ITEST-F4-${tag}`}, ${'itest focus4'}, ${`itest-focus4-${tag}`}, ${cat}, 'approved', true) returning id`)[0].id;
    for (let i = 0; i < 5; i++) {
      const sha = `${tag.toString(16).padStart(12, '0')}${String(i).padStart(52, '0')}`.slice(0, 64);
      const id = (await raw`insert into media_assets (filename, mime, byte_size, width, height, checksum_sha256, storage_key, url, status) values (${`itest-${i}.webp`}, 'image/webp', 1000, 1600, 1600, ${sha}, ${`uploads/assets/it/${sha.slice(0, 12)}/itest-${i}.webp`}, ${`/uploads/assets/it/${sha.slice(0, 12)}/itest-${i}.webp`}, 'ACTIVE') returning id`)[0].id;
      if (i < 4) await raw`insert into media_asset_variants (asset_id, purpose, format, width, height, byte_size, storage_key, url) values (${id}, 'pdp', 'webp', 1024, 1024, 500, ${`uploads/assets/it/${sha.slice(0, 12)}/pdp.webp`}, ${`/uploads/assets/it/${sha.slice(0, 12)}/pdp.webp`})`;
      assetIds.push(id); // the fifth asset has NO rendition: not ready
    }
  });

  afterAll(async () => {
    // audit_logs is immutable by trigger (0055): the itest product's audit rows stay, as the house rule intends.
    if (productId) {
      await raw`delete from media_usages where entity = 'product' and entity_id = ${productId}::uuid`;
      await raw`delete from product_images where product_id = ${productId}::uuid`;
      await raw`delete from products where id = ${productId}::uuid`;
    }
    if (assetIds.length) await raw`delete from media_assets where id = any(${assetIds}::uuid[])`;
    await raw.end();
  });

  it('migration 0148 is in place: slot check, partial unique indexes, media_revision', async () => {
    const cols = await raw`select column_name from information_schema.columns where table_name = 'product_images' and column_name in ('slot', 'updated_at')`;
    expect(cols.map((c: any) => c.column_name).sort()).toEqual(['slot', 'updated_at']);
    const rev = await raw`select column_name from information_schema.columns where table_name = 'products' and column_name = 'media_revision'`;
    expect(rev).toHaveLength(1);
    const idx = await raw`select indexname from pg_indexes where tablename = 'product_images' and indexname in ('product_images_product_slot_uq', 'product_images_product_asset_uq')`;
    expect(idx).toHaveLength(2);
    await expect(raw`insert into product_images (product_id, url, slot) values (${productId}::uuid, '/x', 5)`).rejects.toThrow(/product_images_slot_range/);
    await expect(raw`insert into product_images (product_id, url, slot) values (${productId}::uuid, '/x', 0)`).rejects.toThrow(/product_images_slot_range/);
  });

  it('fills an empty gallery, projects the cover onto products.image_url and writes usages + audit in the transaction', async () => {
    const r = await uc.mutate({ productId, expectedRevision: 0, action: { type: 'ASSIGN', slot: 1, assetId: assetIds[0] }, actorId: actor });
    expect(r.ok).toBe(true);
    expect(r.mediaRevision).toBe(1);
    const p = (await raw`select image_url, has_image, media_revision from products where id = ${productId}::uuid`)[0];
    expect(p.has_image).toBe(true);
    expect(p.image_url).toContain('itest-0.webp');
    expect(p.media_revision).toBe(1);
    const rows = await raw`select slot, is_primary, display_order from product_images where product_id = ${productId}::uuid`;
    expect(rows).toEqual([{ slot: 1, is_primary: true, display_order: 0 }]);
    expect((await raw`select count(*)::int n from media_usages where entity = 'product' and entity_id = ${productId}::uuid and field = 'gallery'`)[0].n).toBe(1);
    expect((await raw`select count(*)::int n from audit_logs where entity = 'product_media' and entity_id = ${productId}::uuid`)[0].n).toBe(1);
  });

  it('refuses an unready asset (no rendition) and an illegal slot through the service', async () => {
    const bad = await uc.mutate({ productId, expectedRevision: 1, action: { type: 'ASSIGN', slot: 2, assetId: assetIds[4] }, actorId: actor });
    expect(bad).toMatchObject({ ok: false, code: 'ASSET_NOT_READY' });
    const slot5 = await uc.mutate({ productId, expectedRevision: 1, action: { type: 'ASSIGN', slot: 5, assetId: assetIds[1] }, actorId: actor });
    expect(slot5).toMatchObject({ ok: false, code: 'INVALID_SLOT' });
  });

  it('set-as-cover swaps slots atomically under the unique index ([A,B,C,D] choosing C → [C,B,A,D])', async () => {
    let rev = 1;
    for (const [slot, asset] of [[2, assetIds[1]], [3, assetIds[2]], [4, assetIds[3]]] as const) {
      const r = await uc.mutate({ productId, expectedRevision: rev, action: { type: 'ASSIGN', slot, assetId: asset }, actorId: actor });
      expect(r.ok).toBe(true); rev = r.mediaRevision;
    }
    const swap = await uc.mutate({ productId, expectedRevision: rev, action: { type: 'SET_COVER', assetId: assetIds[2] }, actorId: actor });
    expect(swap.ok).toBe(true);
    expect(swap.coverChanged).toBe(true);
    const rows = await raw`select slot, asset_id from product_images where product_id = ${productId}::uuid order by slot`;
    expect(rows.map((r: any) => r.asset_id)).toEqual([assetIds[2], assetIds[1], assetIds[0], assetIds[3]]);
    expect((await raw`select count(*)::int n from product_images where product_id = ${productId}::uuid and is_primary`)[0].n).toBe(1);
    expect((await raw`select image_url from products where id = ${productId}::uuid`)[0].image_url).toContain('itest-2.webp');
  });

  it('two writers with the same revision: exactly one wins, the other gets STALE_REVISION', async () => {
    const rev = (await raw`select media_revision from products where id = ${productId}::uuid`)[0].media_revision;
    const [a, b] = await Promise.all([
      uc.mutate({ productId, expectedRevision: rev, action: { type: 'MOVE', from: 4, to: 2 }, actorId: actor }),
      uc.mutate({ productId, expectedRevision: rev, action: { type: 'REMOVE', slot: 4 }, actorId: actor }),
    ]);
    const outcomes = [a, b].map((r) => (r.ok ? 'OK' : r.code)).sort();
    expect(outcomes).toEqual(['OK', 'STALE_REVISION']);
    expect((await raw`select media_revision from products where id = ${productId}::uuid`)[0].media_revision).toBe(rev + 1);
  });

  it('concurrent insertion into an EMPTY gallery yields one cover, never two primaries', async () => {
    const tag = Date.now();
    const cat = (await raw`select id from categories limit 1`)[0].id;
    const pid = (await raw`insert into products (sku, model_number, name, slug, category_id, approval_status, active) values (${`ITEST-F4E-${tag}`}, ${`ITEST-F4E-${tag}`}, 'itest empty', ${`itest-f4e-${tag}`}, ${cat}, 'approved', true) returning id`)[0].id;
    try {
      const [a, b] = await Promise.all([
        uc.mutate({ productId: pid, expectedRevision: 0, action: { type: 'ASSIGN', slot: 1, assetId: assetIds[0] }, actorId: actor }),
        uc.mutate({ productId: pid, expectedRevision: 0, action: { type: 'ASSIGN', slot: 1, assetId: assetIds[1] }, actorId: actor }),
      ]);
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      expect((await raw`select count(*)::int n from product_images where product_id = ${pid}::uuid and is_primary`)[0].n).toBe(1);
      expect((await raw`select count(*)::int n from product_images where product_id = ${pid}::uuid and slot = 1`)[0].n).toBe(1);
    } finally {
      await raw`delete from media_usages where entity = 'product' and entity_id = ${pid}::uuid`;
      await raw`delete from product_images where product_id = ${pid}::uuid`;
      await raw`delete from products where id = ${pid}::uuid`;
    }
  });

  it('removing a secondary clears only that slot and drops its usage; the cover cannot be removed without a replacement', async () => {
    const rev = (await raw`select media_revision from products where id = ${productId}::uuid`)[0].media_revision;
    const before = (await raw`select count(*)::int n from product_images where product_id = ${productId}::uuid and slot is not null`)[0].n;
    const secondary = (await raw`select slot from product_images where product_id = ${productId}::uuid and slot <> 1 order by slot limit 1`)[0].slot;
    const r = await uc.mutate({ productId, expectedRevision: rev, action: { type: 'REMOVE', slot: secondary }, actorId: actor });
    expect(r.ok).toBe(true);
    expect((await raw`select count(*)::int n from product_images where product_id = ${productId}::uuid and slot is not null`)[0].n).toBe(before - 1);
    expect((await raw`select count(*)::int n from media_usages where entity = 'product' and entity_id = ${productId}::uuid and field = 'gallery'`)[0].n).toBe(before - 1);
    const cover = await uc.mutate({ productId, expectedRevision: r.mediaRevision, action: { type: 'REMOVE', slot: 1 }, actorId: actor });
    expect(cover).toMatchObject({ ok: false, code: 'COVER_REQUIRES_REPLACEMENT' });
  });

  it('undo restores the recorded prior map as a new audited revision, only against the current revision', async () => {
    const history = await uc.history(productId, 5);
    const last = history[0];
    const auditBefore = (await raw`select count(*)::int n from audit_logs where entity = 'product_media' and entity_id = ${productId}::uuid`)[0].n;
    const stale = await uc.undo({ productId, expectedRevision: last.revision - 1, auditId: last.id, actorId: actor });
    expect(stale).toMatchObject({ ok: false, code: 'STALE_REVISION' });
    const r = await uc.undo({ productId, expectedRevision: last.revision, auditId: last.id, actorId: actor });
    expect(r.ok).toBe(true);
    expect(r.map.map((a: any) => a.slot)).toEqual(last.previousMap.map((a: any) => a.slot));
    // Exactly one new audit row: the stale attempt wrote nothing, the undo wrote one.
    expect((await raw`select count(*)::int n from audit_logs where entity = 'product_media' and entity_id = ${productId}::uuid`)[0].n).toBe(auditBefore + 1);
  });

  it('the public reader serves slot order and the cover, the completeness query counts it', async () => {
    const { Registry } = await import('../../apps/api/src/infrastructure/Registry');
    const slug = (await raw`select slug from products where id = ${productId}::uuid`)[0].slug;
    const view = await Registry.getInstance().productRepo.findPublicViewBySlug(slug);
    const rows = await raw`select slot, url from product_images where product_id = ${productId}::uuid and slot is not null order by slot`;
    const { resolveGallery } = await import('../../packages/shared/src/media/resolveGallery');
    const gallery = resolveGallery((view?.images ?? []).map((i: any) => ({ ...i, slot: i.slot ?? null })));
    expect(gallery.migrated).toBe(true);
    expect(gallery.ordered.map((i: any) => i.slot)).toEqual(rows.map((r: any) => r.slot));
    expect(gallery.cover?.slot).toBe(1);
    const completeness = (await repo.listCompleteness()).find((c: any) => c.productId === productId);
    expect(completeness).toMatchObject({ assigned: rows.length, hasCover: true, migrated: true });
  });
});
