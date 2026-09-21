import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { buildImportPlan, parseImportFilename, parseManifest, resolveSku, type ProductGalleryContext, type StagedFile } from '../../apps/api/src/domain/media/MediaImportPlanner';
import type { MatchableProduct } from '../../apps/api/src/domain/media/PhotoCodeMatcher';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const file = (filename: string, over: Partial<StagedFile> = {}): StagedFile => ({ filename, sha256: sha(filename), assetId: `asset-${sha(filename).slice(0, 8)}`, ready: true, ...over });
const products: MatchableProduct[] = [
  { id: 'p-c08', name: 'GoldPlus GP-C08 charger', category: 'Power', codes: ['GP-C08', 'GP - C08'] },
  { id: 'p-c10', name: 'GoldPlus GP-C10 charger', category: 'Power', codes: ['GP-C10'] },
  { id: 'p-w04', name: 'GoldPlus GP-W04 earbuds', category: 'Sound', codes: ['GP-W04'] },
  { id: 'p-x1', name: 'Thing X1', category: 'Other', codes: ['X1'] },
  { id: 'p-x1b', name: 'Thing X1 B', category: 'Other', codes: ['X1'] },
];
const gallery = (productId: string, sku: string, map: ProductGalleryContext['currentMap'], hashes: Record<string, string> = {}, rev = 3): ProductGalleryContext => ({ productId, sku, mediaRevision: rev, currentMap: map, assetHashes: hashes });

describe('filename convention and manifest parsing', () => {
  it('parses SKU__01-main.ext; the number is the slot, the suffix is descriptive', () => {
    expect(parseImportFilename('GP-C08__01-main.jpg')).toEqual({ skuToken: 'GP-C08', slot: 1, role: 'main' });
    expect(parseImportFilename('GP-C08__3.webp')).toEqual({ skuToken: 'GP-C08', slot: 3, role: null });
    expect(parseImportFilename('GP-C08.jpg')).toBeNull();
    expect(parseImportFilename('../GP-C08__01-main.jpg')).toEqual({ skuToken: 'GP-C08', slot: 1, role: 'main' });
  });
  it('reads a CSV manifest with a header and refuses one without the required columns', () => {
    const ok = parseManifest('sku,slot,filename,role,alt_text\nGP-C08,2,"c08 side, cropped.jpg",alt,"Side, showing ports"\n', 'csv');
    expect(ok.errors).toEqual([]);
    expect(ok.rows).toEqual([{ sku: 'GP-C08', slot: 2, filename: 'c08 side, cropped.jpg', role: 'alt', alt_text: 'Side, showing ports' }]);
    expect(parseManifest('sku,filename\nGP-C08,x.jpg', 'csv').errors[0]).toMatch(/slot/);
    expect(parseManifest('[{"sku":"GP-C08","slot":1,"filename":"a.jpg"}]', 'json').rows).toHaveLength(1);
  });
  it('resolves an exact SKU and reports ambiguity instead of guessing', () => {
    expect(resolveSku('gp-c08', products)).toEqual({ productId: 'p-c08', sku: 'GP-C08' });
    expect(resolveSku('X1', products)).toEqual({ ambiguous: ['Thing X1', 'Thing X1 B'] });
    expect(resolveSku('GP-Z99', products)).toBeNull();
  });
});

describe('buildImportPlan — statuses the brief lists', () => {
  it('valid names → NEW with one proposed map per product; slot 5 → INVALID_SLOT; unknown SKU → UNMATCHED; ambiguous → AMBIGUOUS', () => {
    const plan = buildImportPlan({
      files: [file('GP-C08__01-main.jpg'), file('GP-C08__02-alt.jpg'), file('GP-C10__05-extra.jpg'), file('GP-Z99__01-main.jpg'), file('X1__01-main.jpg')],
      manifest: [], products, galleries: [gallery('p-c08', 'GP-C08', [])],
    });
    expect(plan.rows.map((r) => r.status)).toEqual(['NEW', 'NEW', 'INVALID_SLOT', 'UNMATCHED_PRODUCT', 'AMBIGUOUS']);
    expect(plan.products).toHaveLength(1);
    expect(plan.products[0].proposedMap.map((a) => a.slot)).toEqual([1, 2]);
    expect(plan.blocking).toBe(true);
  });
  it('duplicate slot in the batch, exact duplicate bytes, unchanged slot and replacement are separate statuses', () => {
    const existingA = file('GP-C08__01-main.jpg');
    const galleryC08 = gallery('p-c08', 'GP-C08', [{ slot: 1, assetId: existingA.assetId!, altText: null }, { slot: 2, assetId: 'asset-old2', altText: null }], { [existingA.assetId!]: existingA.sha256, 'asset-old2': sha('old2') });
    const plan = buildImportPlan({
      files: [
        existingA, // same asset in the same slot → UNCHANGED
        file('GP-C08__02-alt.jpg'), // different asset over an occupied slot → WOULD_REPLACE
        file('GP-C08__03-detail.jpg'), file('GP-C08__03-other.jpg'), // both claim slot 3 → DUPLICATE_SLOT
        file('GP-C08__04-context.jpg', { sha256: sha('old2'), assetId: 'asset-old2-copy' }), // bytes already in the gallery → EXACT_DUPLICATE (assignment still proposed)
      ],
      manifest: [], products, galleries: [galleryC08],
    });
    expect(plan.rows.map((r) => r.status)).toEqual(['UNCHANGED', 'WOULD_REPLACE', 'DUPLICATE_SLOT', 'DUPLICATE_SLOT', 'EXACT_DUPLICATE']);
    const p = plan.products[0];
    expect(p.replaces).toEqual([2]);
    expect(p.proposedMap.map((a) => a.slot)).toEqual([1, 2, 4]);
    expect(p.expectedRevision).toBe(3);
  });
  it('a manifest controls its row; a disagreement with the filename is a MANIFEST_CONFLICT; a duplicate manifest row too', () => {
    const plan = buildImportPlan({
      files: [file('c08-front.jpg'), file('GP-C10__01-main.jpg'), file('twice.jpg')],
      manifest: [
        { sku: 'GP-C08', slot: 1, filename: 'c08-front.jpg', role: 'main', alt_text: 'Front of the pack' },
        { sku: 'GP-W04', slot: 2, filename: 'GP-C10__01-main.jpg' },
        { sku: 'GP-C08', slot: 2, filename: 'twice.jpg' }, { sku: 'GP-C08', slot: 3, filename: 'twice.jpg' },
      ],
      products, galleries: [],
    });
    expect(plan.rows[0]).toMatchObject({ status: 'NEW', source: 'MANIFEST', productId: 'p-c08', slot: 1, altText: 'Front of the pack' });
    expect(plan.rows[1].status).toBe('MANIFEST_CONFLICT');
    expect(plan.rows[2].status).toBe('MANIFEST_CONFLICT');
  });
  it('rejected or unsafe files are INVALID_FILE and never enter a map', () => {
    const plan = buildImportPlan({ files: [file('GP-C08__01-main.jpg', { assetId: null, ready: false, rejectReason: 'TOO_LARGE' }), file('GP-C08__02-alt\u0000.jpg')], manifest: [], products, galleries: [] });
    expect(plan.rows.map((r) => r.status)).toEqual(['INVALID_FILE', 'INVALID_FILE']);
    expect(plan.products).toEqual([]);
  });
  it('the plan hash is deterministic and changes when a revision or a proposed slot changes', () => {
    const files = [file('GP-C08__01-main.jpg')];
    const a = buildImportPlan({ files, manifest: [], products, galleries: [gallery('p-c08', 'GP-C08', [], {}, 1)] });
    const b = buildImportPlan({ files, manifest: [], products, galleries: [gallery('p-c08', 'GP-C08', [], {}, 1)] });
    const c = buildImportPlan({ files, manifest: [], products, galleries: [gallery('p-c08', 'GP-C08', [], {}, 2)] });
    expect(a.planHash).toBe(b.planHash);
    expect(a.planHash).not.toBe(c.planHash);
  });
});

describe('a realistic 180-file batch reconciles without opening 180 editors', () => {
  it('45 products × 4 frames, with a sprinkling of exceptions, yields an understandable plan', () => {
    const catalogue: MatchableProduct[] = Array.from({ length: 45 }, (_, i) => ({ id: `p${i}`, name: `Product ${i}`, category: 'Other', codes: [`GP-T${String(i).padStart(2, '0')}`] }));
    const files: StagedFile[] = [];
    for (let i = 0; i < 45; i++) for (const [slot, role] of [[1, 'main'], [2, 'alt'], [3, 'detail'], [4, 'context']] as const) files.push(file(`GP-T${String(i).padStart(2, '0')}__0${slot}-${role}.webp`));
    // exceptions: an unknown SKU, a slot 5, a duplicate slot, a rejected file
    files[7] = file('GP-T99__01-main.webp');
    files[13] = file('GP-T03__05-extra.webp');
    files[22] = file('GP-T05__02-alt-2.webp'); // product 5 now has two files claiming slot 2 (indexes 21 and 22)
    files[30] = file('GP-T07__03-detail.webp', { assetId: null, ready: false, rejectReason: 'UNSUPPORTED_TYPE' });
    const galleries = catalogue.map((p) => gallery(p.id, p.codes[0], [], {}, 0));
    const plan = buildImportPlan({ files, manifest: [], products: catalogue, galleries });
    expect(plan.totals.TOTAL).toBe(180);
    expect(plan.totals.UNMATCHED_PRODUCT).toBe(1);
    expect(plan.totals.INVALID_SLOT).toBe(1);
    expect(plan.totals.DUPLICATE_SLOT).toBe(2);
    expect(plan.totals.INVALID_FILE).toBe(1);
    expect(plan.totals.NEW).toBe(175);
    expect(plan.products.length).toBe(45);
    expect(plan.blocking).toBe(true);
    // The operator fixes four things, not 180: every issue names the file and the reason.
    const issues = plan.rows.filter((r) => r.issues.length).map((r) => `${r.filename}: ${r.issues[0]}`);
    expect(issues).toHaveLength(5);
  });
});
