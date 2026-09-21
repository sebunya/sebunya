import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { MediaImportUseCases } from '../../apps/api/src/application/use-cases/media/MediaImportUseCases';
import { ProductMediaUseCases } from '../../apps/api/src/application/use-cases/media/ProductMediaUseCases';
import type { ApplyRowStatus, IMediaImportRepository, MediaImportRowRecord, MediaImportSessionRecord, MediaImportStatus } from '../../apps/api/src/application/ports/IMediaImportRepository';
import type { ApplySlotMapResult, IProductMediaRepository, ProductMediaSnapshot, ReadyAsset, SlotMapAudit } from '../../apps/api/src/application/ports/IProductMediaRepository';
import type { ImportPlan, ImportRowStatus, ProductPlan } from '../../apps/api/src/domain/media/MediaImportPlanner';
import type { SlotMap } from '../../apps/api/src/domain/media/ProductMediaSlotMap';

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const file = (filename: string, content = filename) => ({ filename, mime: 'image/jpeg', buffer: Buffer.from(content) });

/** In-memory gallery: products with revisions and slot maps; applySlotMap behaves like the real one (revision check, ready check). */
class FakeGalleryRepo implements IProductMediaRepository {
  products = new Map<string, { sku: string; mediaRevision: number; map: SlotMap }>();
  ready = new Set<string>();
  audits: SlotMapAudit[] = [];
  failNext: string | null = null;
  async getSnapshot(productId: string): Promise<ProductMediaSnapshot | null> {
    const p = this.products.get(productId);
    if (!p) return null;
    return {
      productId, sku: p.sku, name: p.sku, slug: p.sku.toLowerCase(), mediaRevision: p.mediaRevision,
      rows: p.map.map((a, i) => ({ imageId: `img-${a.assetId}`, assetId: a.assetId, slot: a.slot, isPrimary: a.slot === 1, displayOrder: a.slot - 1, url: `/u/${a.assetId}/x.webp`, altText: a.altText, asset: { filename: `${a.assetId}.webp`, checksum: `hash-${a.assetId}`, width: 1000, height: 1000, byteSize: 1, status: 'ACTIVE', displayUrl: null, thumbUrl: null, ready: this.ready.has(a.assetId) } })),
    };
  }
  async findReadyAssets(ids: readonly string[]): Promise<ReadyAsset[]> { return ids.filter((id) => this.ready.has(id)).map((id) => ({ id, url: `/u/${id}/x.webp`, altText: null })); }
  async applySlotMap(productId: string, expectedRevision: number, map: SlotMap, audit: SlotMapAudit): Promise<ApplySlotMapResult> {
    const p = this.products.get(productId);
    if (!p) return { kind: 'NOT_FOUND' };
    if (p.mediaRevision !== expectedRevision) return { kind: 'STALE', currentRevision: p.mediaRevision };
    if (this.failNext === productId) { this.failNext = null; throw new Error('disk on fire'); }
    p.map = [...map].sort((a, b) => a.slot - b.slot); p.mediaRevision += 1; this.audits.push(audit);
    return { kind: 'APPLIED', mediaRevision: p.mediaRevision, map: [...p.map] };
  }
  async listGalleryAudit() { return []; }
}

class FakeImportRepo implements IMediaImportRepository {
  sessions = new Map<string, MediaImportSessionRecord>();
  rowStore = new Map<string, MediaImportRowRecord[]>();
  private n = 0;
  async create(input: { name: string; plan: ImportPlan; manifestSha256: string | null; manifestFilename: string | null; actorId: string }) {
    const id = `s${++this.n}`;
    const s: MediaImportSessionRecord = { id, name: input.name, status: 'PLANNED', version: 1, importerVersion: input.plan.importerVersion, manifestSha256: input.manifestSha256, manifestFilename: input.manifestFilename, planHash: input.plan.planHash, totals: input.plan.totals, blocking: input.plan.blocking, createdBy: input.actorId, approvedBy: null, approvedAt: null, rejectedReason: null, appliedBy: null, appliedAt: null, applySummary: null, createdAt: new Date(), updatedAt: new Date() };
    this.sessions.set(id, s);
    const byProduct = new Map(input.plan.products.map((p) => [p.productId, p]));
    this.rowStore.set(id, input.plan.rows.map((r) => { const p = r.productId ? byProduct.get(r.productId) : undefined; return { ...r, id: `${id}-r${r.rowNumber}`, sessionId: id, expectedRevision: p?.expectedRevision ?? null, currentMap: p?.currentMap ?? null, proposedMap: p?.proposedMap ?? null, applyStatus: null, appliedRevision: null, appliedAt: null, error: null }; }));
    return s;
  }
  async list() { return [...this.sessions.values()]; }
  async find(id: string) { return this.sessions.get(id) ?? null; }
  async rows(id: string) { return this.rowStore.get(id) ?? []; }
  async rowsOf(id: string) { return this.rows(id); }
  async transition(id: string, expectedVersion: number, from: MediaImportStatus[], patch: Partial<MediaImportSessionRecord>) {
    const s = this.sessions.get(id);
    if (!s || s.version !== expectedVersion || !from.includes(s.status)) return null;
    Object.assign(s, patch, { version: expectedVersion + 1 });
    return s;
  }
  async markRows(sessionId: string, productId: string, patch: { applyStatus: ApplyRowStatus; appliedRevision?: number | null; error?: string | null }, onlyStatuses?: ImportRowStatus[]) {
    let n = 0;
    for (const r of this.rowStore.get(sessionId) ?? []) if (r.productId === productId && (!onlyStatuses || onlyStatuses.includes(r.status))) { r.applyStatus = patch.applyStatus; r.appliedRevision = patch.appliedRevision ?? null; r.error = patch.error ?? null; n++; }
    return n;
  }
  async productPlans(sessionId: string): Promise<ProductPlan[]> {
    const out = new Map<string, ProductPlan>();
    for (const r of this.rowStore.get(sessionId) ?? []) if (r.productId && r.proposedMap && r.expectedRevision !== null && !out.has(r.productId)) out.set(r.productId, { productId: r.productId, sku: r.productSku ?? '', expectedRevision: r.expectedRevision, currentMap: r.currentMap ?? [], proposedMap: r.proposedMap, replaces: [] });
    return [...out.values()];
  }
}

function harness() {
  const galleryRepo = new FakeGalleryRepo();
  const gallery = new ProductMediaUseCases(galleryRepo);
  const importRepo = new FakeImportRepo();
  const library = { upload: async (args: { files: Array<{ filename: string; buffer: Buffer }> }) => args.files.map((f) => { const id = `a-${sha(f.buffer).slice(0, 6)}`; galleryRepo.ready.add(id); return f.filename.includes('bad') ? { kind: 'REJECTED' as const, filename: f.filename, reason: 'UNSUPPORTED_TYPE' } : { kind: 'STORED' as const, asset: { id, checksum: sha(f.buffer) }, deduplicated: false }; }) };
  const catalogue = { listCodeIndex: async () => [{ id: 'p1', name: 'P1', category: 'Other', codes: ['GP-A1'] }, { id: 'p2', name: 'P2', category: 'Other', codes: ['GP-B2'] }] };
  galleryRepo.products.set('p1', { sku: 'GP-A1', mediaRevision: 0, map: [] });
  galleryRepo.products.set('p2', { sku: 'GP-B2', mediaRevision: 0, map: [] });
  const uc = new MediaImportUseCases(importRepo as unknown as IMediaImportRepository, library, catalogue, galleryRepo, gallery);
  return { uc, galleryRepo, importRepo };
}

describe('MediaImportUseCases — stage → four eyes → apply → resume', () => {
  it('stages a plan, refuses self-approval, approves with a second person, applies one transaction per product', async () => {
    const { uc, galleryRepo } = harness();
    const staged = await uc.stage({ name: 'batch', files: [file('GP-A1__01-main.jpg'), file('GP-A1__02-alt.jpg'), file('GP-B2__01-main.jpg')], actorId: 'maker' });
    if (!staged.ok) throw new Error(staged.message);
    expect(staged.plan.totals.NEW).toBe(3);
    expect(staged.session.status).toBe('PLANNED');
    expect(galleryRepo.products.get('p1')!.map).toEqual([]); // staging touched no gallery

    const self = await uc.approve({ id: staged.session.id, expectedVersion: 1, actorId: 'maker', decision: 'APPROVED', reason: '' });
    expect(self).toMatchObject({ ok: false, code: 'FOUR_EYES_REQUIRED' });
    const approved = await uc.approve({ id: staged.session.id, expectedVersion: 1, actorId: 'checker', decision: 'APPROVED', reason: '' });
    if (!approved.ok) throw new Error(approved.message);

    const applied = await uc.apply({ id: staged.session.id, expectedVersion: approved.session.version, actorId: 'checker' });
    if (!applied.ok) throw new Error(applied.message);
    expect(applied.summary).toMatchObject({ applied: 2, failed: 0, notAttempted: 0 });
    expect(applied.session.status).toBe('APPLIED');
    expect(galleryRepo.products.get('p1')!.map.map((a) => a.slot)).toEqual([1, 2]);
    expect(galleryRepo.products.get('p2')!.map.map((a) => a.slot)).toEqual([1]);
    expect(galleryRepo.audits.every((a) => a.action.startsWith('IMPORT:'))).toBe(true);
  });

  it('a blocking row prevents approval', async () => {
    const { uc } = harness();
    const staged = await uc.stage({ name: 'b', files: [file('GP-A1__01-main.jpg'), file('GP-ZZ__01-main.jpg')], actorId: 'maker' });
    if (!staged.ok) throw new Error(staged.message);
    expect(await uc.approve({ id: staged.session.id, expectedVersion: 1, actorId: 'checker', decision: 'APPROVED', reason: '' })).toMatchObject({ ok: false, code: 'PLAN_BLOCKED' });
  });

  it('a stale revision (someone edited the gallery after approval) is recorded per product, never overwritten', async () => {
    const { uc, galleryRepo } = harness();
    const staged = await uc.stage({ name: 'c', files: [file('GP-A1__01-main.jpg'), file('GP-B2__01-main.jpg')], actorId: 'maker' });
    if (!staged.ok) throw new Error(staged.message);
    await uc.approve({ id: staged.session.id, expectedVersion: 1, actorId: 'checker', decision: 'APPROVED', reason: '' });
    galleryRepo.products.get('p1')!.mediaRevision = 5; // an operator edited p1 meanwhile
    const applied = await uc.apply({ id: staged.session.id, expectedVersion: 2, actorId: 'checker' });
    if (!applied.ok) throw new Error(applied.message);
    expect(applied.summary).toMatchObject({ applied: 1, stale: 1 });
    expect(applied.session.status).toBe('PARTIALLY_APPLIED');
    expect(galleryRepo.products.get('p1')!.map).toEqual([]);
  });

  it('an unexpected failure stops the batch, leaves the rest NOT_ATTEMPTED, and resume finishes them without re-applying', async () => {
    const { uc, galleryRepo, importRepo } = harness();
    const staged = await uc.stage({ name: 'd', files: [file('GP-A1__01-main.jpg'), file('GP-B2__01-main.jpg')], actorId: 'maker' });
    if (!staged.ok) throw new Error(staged.message);
    await uc.approve({ id: staged.session.id, expectedVersion: 1, actorId: 'checker', decision: 'APPROVED', reason: '' });
    galleryRepo.failNext = 'p1';
    const first = await uc.apply({ id: staged.session.id, expectedVersion: 2, actorId: 'checker' });
    if (!first.ok) throw new Error(first.message);
    expect(first.summary).toMatchObject({ failed: 1, notAttempted: 1, applied: 0 });
    expect(first.session.status).toBe('FAILED');
    const rowsAfter = await importRepo.rowsOf(staged.session.id);
    expect(rowsAfter.map((r) => r.applyStatus)).toEqual(['FAILED', 'NOT_ATTEMPTED']);

    const resumed = await uc.apply({ id: staged.session.id, expectedVersion: first.session.version, actorId: 'checker', resume: true });
    if (!resumed.ok) throw new Error(resumed.message);
    expect(resumed.summary).toMatchObject({ applied: 2, failed: 0 });
    expect(resumed.session.status).toBe('APPLIED');
    // Applying again is refused: the session is finished, and the galleries are unchanged.
    const again = await uc.apply({ id: staged.session.id, expectedVersion: resumed.session.version, actorId: 'checker', resume: true });
    expect(again.ok).toBe(false);
    expect(galleryRepo.products.get('p1')!.mediaRevision).toBe(1);
    expect(galleryRepo.products.get('p2')!.mediaRevision).toBe(1);
  });

  it('a rejected file is INVALID_FILE in the plan; the good files are still planned', async () => {
    const { uc } = harness();
    const staged = await uc.stage({ name: 'e', files: [file('GP-A1__01-main.jpg'), file('GP-A1__02-bad.jpg')], actorId: 'maker' });
    if (!staged.ok) throw new Error(staged.message);
    expect(staged.plan.rows.map((r) => r.status)).toEqual(['NEW', 'INVALID_FILE']);
    expect(staged.plan.blocking).toBe(true);
  });
});
