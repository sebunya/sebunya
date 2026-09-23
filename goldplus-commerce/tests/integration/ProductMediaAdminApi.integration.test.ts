import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Fixtures } from './helpers/fixtures';
/**
 * Focus 4 — the ADMIN API end to end on REAL PostgreSQL (disposable production
 * copy): the real Hono app, the real Registry, the real media library (sharp
 * renditions), only authentication stubbed (the Bearer token names the actor,
 * so two different people can act). Proves what the admin pages depend on:
 *   gallery read → multi-upload with slot map → set cover → stale revision 409 →
 *   queue + reconciliation CSV → bulk import stage → self-approval refused →
 *   second-person approval → apply → results CSV → backfill dry run on the copy.
 */
const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

vi.mock('../../apps/api/src/interfaces/http/middleware/auth', async () => {
  const { PERMISSIONS } = await import('../../packages/shared/src/permissions');
  return {
    authMiddleware: async (c: any, next: any) => {
      const auth = c.req.header('Authorization') ?? '';
      const id = auth.replace(/^Bearer\s+/i, '').trim();
      if (!id) return c.json({ success: false, error: { code: 'UNAUTHENTICATED' } }, 401);
      c.set('user', { id, email: `${id}@itest`, permissions: Object.values(PERMISSIONS) });
      await next();
    },
  };
});

const { createRequire } = await import('node:module');
const sharp = createRequire(import.meta.url)('sharp');
// Distinct bytes per label WITHOUT relying on fonts (the container may have none): the label
// picks the fill colour and a stripe. 1200 px = a normal master (gets a pdp rendition);
// 640 px = a small but valid original (no pdp rendition; served as-is; must still be READY).
async function webp(label: string, size = 1200): Promise<Buffer> {
  let h = 0; for (const ch of label) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const fill = `#${(h & 0xffffff).toString(16).padStart(6, '0')}`;
  const stripe = 20 + (h % 200);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="${fill}"/><rect x="${stripe}" y="0" width="${Math.round(size / 10)}" height="100%" fill="#0A0A0A"/></svg>`;
  return sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer();
}

suite('product media admin API (real PostgreSQL, real app)', () => {
  let app: any; let raw: any; let maker: string; let checker: string;
  let productId = ''; let sku = ''; let slug = '';
  const created: { assets: string[]; sessions: string[] } = { assets: [], sessions: [] };
  let fx: Fixtures; let legacyProductId = '';
  const J = { 'Content-Type': 'application/json' };
  const as = (actor: string, init: RequestInit = {}) => ({ ...init, headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${actor}` } });

  beforeAll(async () => {
    raw = createRequire(import.meta.url)('postgres')(URL as string, { max: 4, onnotice: () => undefined });
    app = (await import('../../apps/api/src/interfaces/http/app')).default;
    // Two DIFFERENT people: the import approval is four-eyes, so a lone user would test nothing.
    fx = new Fixtures(raw);
    maker = await fx.user(); checker = await fx.user();
    const cat = await fx.category();
    const tag = Date.now();
    sku = `ITEST-ADM-${tag}`; slug = `itest-adm-${tag}`;
    productId = (await raw`insert into products (sku, model_number, name, slug, category_id, approval_status, active) values (${sku}, ${sku}, 'itest admin gallery', ${slug}, ${cat}, 'approved', true) returning id`)[0].id;
  }, 60_000);

  afterAll(async () => {
    if (productId) {
      await raw`delete from media_import_rows where product_id = ${productId}::uuid`;
      await raw`delete from media_usages where entity = 'product' and entity_id = ${productId}::uuid`;
      await raw`delete from product_images where product_id = ${productId}::uuid`;
      await raw`delete from products where id = ${productId}::uuid`;
    }
    for (const s of created.sessions) await raw`delete from media_import_sessions where id = ${s}::uuid`;
    if (legacyProductId) await raw`delete from product_images where product_id = ${legacyProductId}::uuid`;
    if (created.assets.length) {
      await raw`delete from media_asset_variants where asset_id = any(${created.assets}::uuid[])`;
      await raw`delete from media_assets where id = any(${created.assets}::uuid[])`;
    }
    await fx?.cleanup();
    await raw.end();
  });

  const galleryOf = async (actor = maker) => {
    const res = await app.request(`/admin/products/${productId}/media`, as(actor));
    expect(res.status).toBe(200);
    return (await res.json()).data;
  };

  it('starts empty: 0/4, revision 0, no cover', async () => {
    const g = await galleryOf();
    expect(g.completeness).toEqual({ assigned: 0, label: '0/4', hasCover: false });
    expect(g.mediaRevision).toBe(0);
    expect(g.slots.map((s: any) => s.assetId)).toEqual([null, null, null, null]);
  });

  it('multi-upload places files into the proposed slots in one revision-checked write; a fifth file is refused', async () => {
    const fd = new FormData();
    for (const n of [1, 2, 3]) fd.append('files', new Blob([await webp(`F${n}`)], { type: 'image/webp' }), `${sku}__0${n}-frame.webp`);
    fd.append('expectedRevision', '0');
    for (const s of ['1', '2', '3']) fd.append('slots', s);
    const res = await app.request(`/admin/products/${productId}/media/upload`, as(maker, { method: 'POST', body: fd }));
    const body = await res.json();
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.data.mediaRevision).toBe(1);
    expect(body.data.map.map((a: any) => a.slot)).toEqual([1, 2, 3]);
    created.assets.push(...body.data.staged.map((s: any) => s.assetId));
    const g = await galleryOf();
    expect(g.completeness.label).toBe('3/4');
    expect(g.slots[0].ready).toBe(true); // sharp made the pdp rendition
    expect((await raw`select image_url from products where id = ${productId}::uuid`)[0].image_url).toBeTruthy();

    const five = new FormData();
    for (let n = 0; n < 5; n++) five.append('files', new Blob([await webp(`X${n}`, 200)], { type: 'image/webp' }), `x${n}.webp`);
    five.append('expectedRevision', '1');
    const tooMany = await app.request(`/admin/products/${productId}/media/upload`, as(maker, { method: 'POST', body: five }));
    expect(tooMany.status).toBe(400);
    expect((await tooMany.json()).error.message).toMatch(/four images/);
  });

  it('set as cover swaps with slot 1; a stale editor gets 409 with the current revision; undo restores', async () => {
    const before = await galleryOf();
    const third = before.slots[2].assetId;
    const swap = await app.request(`/admin/products/${productId}/media`, as(maker, { method: 'PUT', headers: J, body: JSON.stringify({ expectedRevision: before.mediaRevision, action: { type: 'SET_COVER', assetId: third } }) }));
    expect(swap.status).toBe(200);
    const after = await galleryOf();
    expect(after.slots[0].assetId).toBe(third);
    expect(after.slots[2].assetId).toBe(before.slots[0].assetId);
    const stale = await app.request(`/admin/products/${productId}/media`, as(checker, { method: 'PUT', headers: J, body: JSON.stringify({ expectedRevision: before.mediaRevision, action: { type: 'REMOVE', slot: 2 } }) }));
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toMatchObject({ code: 'STALE_REVISION', currentRevision: after.mediaRevision });
    const last = after.history[0];
    const undo = await app.request(`/admin/products/${productId}/media`, as(checker, { method: 'PUT', headers: J, body: JSON.stringify({ expectedRevision: after.mediaRevision, action: { type: 'UNDO', auditId: last.id } }) }));
    expect(undo.status).toBe(200);
    expect((await galleryOf()).slots[0].assetId).toBe(before.slots[0].assetId);
  });

  it('the cover cannot be removed without a replacement (422), a secondary can', async () => {
    const g = await galleryOf();
    const noRepl = await app.request(`/admin/products/${productId}/media`, as(maker, { method: 'PUT', headers: J, body: JSON.stringify({ expectedRevision: g.mediaRevision, action: { type: 'REMOVE', slot: 1 } }) }));
    expect(noRepl.status).toBe(422);
    expect((await noRepl.json()).error.code).toBe('COVER_REQUIRES_REPLACEMENT');
    const rm = await app.request(`/admin/products/${productId}/media`, as(maker, { method: 'PUT', headers: J, body: JSON.stringify({ expectedRevision: g.mediaRevision, action: { type: 'REMOVE', slot: 3 } }) }));
    expect(rm.status).toBe(200);
    expect((await galleryOf()).completeness.label).toBe('2/4');
  });

  it('the queue counts this product and the reconciliation CSV lists it, formula-safe', async () => {
    const q = await app.request('/admin/media/gallery-queue?filter=2', as(maker));
    expect(q.status).toBe(200);
    const items = (await q.json()).data.items;
    expect(items.some((p: any) => p.productId === productId && p.assigned === 2 && p.hasCover && p.migrated)).toBe(true);
    const csv = await app.request('/admin/media/gallery-queue/reconciliation.csv', as(maker));
    expect(csv.status).toBe(200);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    const text = await csv.text();
    expect(text.split('\r\n')[0]).toContain('sku,product,slug');
    expect(text).toContain(sku);
    expect(text).toContain('INVENTORY');
  });

  it('bulk import: stage → self-approval refused → second person approves → apply → results CSV', async () => {
    const fd = new FormData();
    fd.append('name', 'itest batch');
    fd.append('files', new Blob([await webp('C3')], { type: 'image/webp' }), `${sku}__03-detail.webp`);
    fd.append('files', new Blob([await webp('C4')], { type: 'image/webp' }), `${sku}__04-context.webp`);
    fd.append('files', new Blob([await webp('C5')], { type: 'image/webp' }), `NO-SUCH-SKU-${Date.now()}__01-main.webp`);
    const staged = await app.request('/admin/media-imports', as(maker, { method: 'POST', body: fd }));
    const sbody = await staged.json();
    expect(staged.status, JSON.stringify(sbody)).toBe(201);
    const sessionId = sbody.data.session.id; created.sessions.push(sessionId);
    expect(sbody.data.totals.NEW).toBe(2);
    expect(sbody.data.totals.UNMATCHED_PRODUCT).toBe(1);
    expect(sbody.data.blocking).toBe(true);
    const detail = (await (await app.request(`/admin/media-imports/${sessionId}`, as(maker))).json()).data;
    created.assets.push(...detail.rows.map((r: any) => r.assetId).filter(Boolean));
    // Blocked by the unmatched row: approval refused for anyone.
    const blocked = await app.request(`/admin/media-imports/${sessionId}/approval`, as(checker, { method: 'POST', headers: J, body: JSON.stringify({ expectedVersion: 1, decision: 'APPROVED', reason: '' }) }));
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error.code).toBe('PLAN_BLOCKED');

    // Stage a clean batch; the maker cannot approve their own plan.
    const fd2 = new FormData();
    fd2.append('name', 'itest clean batch');
    fd2.append('files', new Blob([await webp('D3')], { type: 'image/webp' }), `${sku}__03-detail.webp`);
    // A 640 px original: valid, below the 1024 display size, so it gets no pdp rendition — it must still be READY.
    fd2.append('files', new Blob([await webp('D4', 640)], { type: 'image/webp' }), `${sku}__04-context.webp`);
    const staged2 = await app.request('/admin/media-imports', as(maker, { method: 'POST', body: fd2 }));
    const s2body = await staged2.json();
    expect(staged2.status, JSON.stringify(s2body)).toBe(201);
    expect(s2body.data.totals).toMatchObject({ NEW: 2, INVALID_FILE: 0 });
    const s2 = s2body.data.session; created.sessions.push(s2.id);
    const d2 = (await (await app.request(`/admin/media-imports/${s2.id}`, as(maker))).json()).data;
    created.assets.push(...d2.rows.map((r: any) => r.assetId).filter(Boolean));
    const self = await app.request(`/admin/media-imports/${s2.id}/approval`, as(maker, { method: 'POST', headers: J, body: JSON.stringify({ expectedVersion: s2.version, decision: 'APPROVED', reason: '' }) }));
    expect(self.status).toBe(403);
    if (checker === maker) return; // a single-user copy cannot exercise the second person
    const approved = await app.request(`/admin/media-imports/${s2.id}/approval`, as(checker, { method: 'POST', headers: J, body: JSON.stringify({ expectedVersion: s2.version, decision: 'APPROVED', reason: '' }) }));
    expect(approved.status).toBe(200);
    const v = (await approved.json()).data.version;
    const applied = await app.request(`/admin/media-imports/${s2.id}/apply`, as(checker, { method: 'POST', headers: J, body: JSON.stringify({ expectedVersion: v }) }));
    const abody = await applied.json();
    expect(applied.status, JSON.stringify(abody)).toBe(200);
    expect(abody.data.summary).toMatchObject({ applied: 1, failed: 0, notAttempted: 0 });
    expect(abody.data.session.status).toBe('APPLIED');
    const g = await galleryOf();
    expect(g.completeness.label).toBe('4/4');
    expect(g.slots.map((s: any) => Boolean(s.assetId))).toEqual([true, true, true, true]);
    const results = await app.request(`/admin/media-imports/${s2.id}/results.csv`, as(maker));
    expect(results.status).toBe(200);
    expect(await results.text()).toContain('APPLIED');
    // Applying again is refused (idempotent at the session level) and the galleries are unchanged.
    const again = await app.request(`/admin/media-imports/${s2.id}/apply`, as(checker, { method: 'POST', headers: J, body: JSON.stringify({ expectedVersion: abody.data.session.version }) }));
    expect(again.status).toBe(409);
    expect((await galleryOf()).mediaRevision).toBe(g.mediaRevision);
  });

  it('the legacy add-by-URL route is gone (410) and the legacy delete route goes through the gallery', async () => {
    const gone = await app.request(`/admin/products/${productId}/images`, as(maker, { method: 'POST', headers: J, body: JSON.stringify({ url: 'https://example.com/x.jpg' }) }));
    expect(gone.status).toBe(410);
    const g = await galleryOf();
    const coverImageId = g.slots[0].imageId;
    const del = await app.request(`/admin/products/images/${coverImageId}`, as(maker, { method: 'DELETE' }));
    expect(del.status).toBe(409);
    expect((await del.json()).error.code).toBe('COVER_REQUIRES_REPLACEMENT');
  });

  it('backfill dry run: a legacy primary becomes a clean ASSIGN_COVER, and no current primary conflicts', async () => {
    const { Registry } = await import('../../apps/api/src/infrastructure/Registry');
    const { planBackfill } = await import('../../apps/api/src/domain/media/ProductMediaBackfill');
    const repo = Registry.getInstance().productMediaRepo as any;
    // A legacy (pre-slot) product with one primary image on a ready asset — what every
    // imaged product looked like before 0148. Seeded here so the dry run has a known case
    // on ANY database, not only on a production copy that happens to contain some.
    const legacy = await fx.product();
    legacyProductId = legacy.id;
    const sha = `${Date.now().toString(16)}`.padEnd(64, 'b').slice(0, 64);
    const assetId = (await raw`insert into media_assets (filename, mime, byte_size, width, height, checksum_sha256, storage_key, url, status)
      values ('itest-legacy.webp', 'image/webp', 1000, 1600, 1600, ${sha}, ${`uploads/assets/it/${sha.slice(0, 12)}/itest-legacy.webp`}, ${`/uploads/assets/it/${sha.slice(0, 12)}/itest-legacy.webp`}, 'ACTIVE') returning id`)[0].id;
    created.assets.push(assetId);
    await raw`insert into media_asset_variants (asset_id, purpose, format, width, height, byte_size, storage_key, url)
      values (${assetId}, 'pdp', 'webp', 1024, 1024, 500, ${`uploads/assets/it/${sha.slice(0, 12)}/pdp.webp`}, ${`/uploads/assets/it/${sha.slice(0, 12)}/pdp.webp`})`;
    await raw`insert into product_images (product_id, url, is_primary, display_order, asset_id)
      values (${legacy.id}, ${`/uploads/assets/it/${sha.slice(0, 12)}/itest-legacy.webp`}, true, 0, ${assetId})`;
    let legacyDecision = '';
    const decisions: Record<string, number> = {};
    let after: string | null = null;
    for (;;) {
      const page = await repo.listUnmigratedProducts(100, after);
      if (!page.length) break;
      for (const p of page) {
        after = p.productId;
        const snap = await repo.getSnapshot(p.productId);
        const d = planBackfill({ mediaRevision: snap.mediaRevision }, snap.rows.map((r: any) => ({ imageId: r.imageId, assetId: r.assetId, slot: r.slot, isPrimary: r.isPrimary, displayOrder: r.displayOrder, altText: r.altText, assetReady: r.asset?.ready ?? false })));
        const key = d.kind === 'CONFLICT' ? `CONFLICT:${d.code}` : d.kind;
        decisions[key] = (decisions[key] ?? 0) + 1;
        if (p.productId === legacy.id) legacyDecision = key;
      }
    }
    // The itest product itself is migrated, so it is not in this set.
    expect(legacyDecision).toBe('ASSIGN_COVER');
    expect(decisions.ASSIGN_COVER ?? 0).toBeGreaterThan(0);
    expect(Object.keys(decisions).filter((k) => k.startsWith('CONFLICT'))).toEqual([]);
    console.log('backfill dry run on the copy:', JSON.stringify(decisions));
  });
});
