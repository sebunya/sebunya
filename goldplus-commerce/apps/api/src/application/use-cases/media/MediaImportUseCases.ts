import { createHash } from 'node:crypto';
import { describeUploadRejection } from './MediaLibraryUseCase';
import { BLOCKING_STATUSES, buildImportPlan, parseManifest, type ImportPlan, type ManifestRow, type ProductGalleryContext, type StagedFile } from '../../../domain/media/MediaImportPlanner';
import type { MatchableProduct } from '../../../domain/media/PhotoCodeMatcher';
import type { GallerySlot } from '@goldplus/shared';
import type { IMediaImportRepository, MediaImportRowRecord, MediaImportSessionRecord } from '../../ports/IMediaImportRepository';
import type { IProductMediaRepository } from '../../ports/IProductMediaRepository';
import type { ProductMediaUseCases } from './ProductMediaUseCases';

/**
 * Focus 4 — reviewed, reproducible, recoverable bulk image import.
 *
 *   stage    files (+ optional manifest) → media library (type sniffed, hashed,
 *            deduplicated, renditions) → deterministic plan → persisted session.
 *            No gallery is touched. Staging IS a write (assets + a session row);
 *            it is labelled as such, never called "read-only".
 *   approve  a DIFFERENT person than the one who staged (FOUR_EYES_REQUIRED),
 *            only when the plan has no blocking row.
 *   apply    re-verifies each product's revision and each asset's readiness,
 *            then ONE revision-checked slot-map write per product. Per-product
 *            outcomes go to the ledger; an unexpected failure stops further work
 *            and leaves the rest NOT_ATTEMPTED. Reapplying the same session is
 *            idempotent: applied products are skipped, unchanged ones too.
 *   resume   applies only the NOT_ATTEMPTED / STALE products after review.
 *
 * Nothing here deletes an asset, ever.
 */

export interface MediaImportLibraryPort {
  upload(args: { files: Array<{ filename: string; mime: string; buffer: Buffer }>; altText?: string | null; caption?: string | null; actorId: string }): Promise<Array<
    | { kind: 'STORED'; asset: { id: string; checksum: string }; deduplicated: boolean }
    | { kind: 'REJECTED'; filename: string; reason: string }
  >>;
}

export interface MediaImportCataloguePort {
  listCodeIndex(): Promise<MatchableProduct[]>;
}

export type MediaImportError = { ok: false; code: 'NOT_FOUND' | 'STALE_VERSION' | 'FOUR_EYES_REQUIRED' | 'PLAN_BLOCKED' | 'INVALID_STATE' | 'BAD_INPUT'; message: string };

const MAX_FILES = 250;

export class MediaImportUseCases {
  constructor(
    private readonly repo: IMediaImportRepository,
    private readonly library: MediaImportLibraryPort,
    private readonly catalogue: MediaImportCataloguePort,
    private readonly galleryRepo: IProductMediaRepository,
    private readonly gallery: ProductMediaUseCases,
  ) {}

  list(limit = 50) { return this.repo.list(limit); }

  async detail(id: string): Promise<{ session: MediaImportSessionRecord; rows: MediaImportRowRecord[] } | null> {
    const session = await this.repo.find(id);
    if (!session) return null;
    return { session, rows: await this.repo.rows(id) };
  }

  async stage(input: {
    name: string;
    files: Array<{ filename: string; mime: string; buffer: Buffer }>;
    manifest?: { filename: string; text: string } | null;
    actorId: string;
  }): Promise<{ ok: true; session: MediaImportSessionRecord; plan: ImportPlan; manifestErrors: string[] } | MediaImportError> {
    if (!input.files.length) return { ok: false, code: 'BAD_INPUT', message: 'Choose at least one image file.' };
    if (input.files.length > MAX_FILES) return { ok: false, code: 'BAD_INPUT', message: `At most ${MAX_FILES} files per import session; split the batch.` };

    let manifestRows: ManifestRow[] = [];
    let manifestErrors: string[] = [];
    let manifestSha: string | null = null;
    if (input.manifest) {
      const kind = /\.json$/i.test(input.manifest.filename) ? 'json' : 'csv';
      const parsed = parseManifest(input.manifest.text, kind);
      manifestRows = parsed.rows;
      manifestErrors = parsed.errors;
      manifestSha = createHash('sha256').update(input.manifest.text).digest('hex');
    }

    // 1. Stage bytes through the library (one file at a time so one rejection never hides another).
    const staged: StagedFile[] = [];
    for (const f of input.files) {
      const sha256 = createHash('sha256').update(f.buffer).digest('hex');
      const [outcome] = await this.library.upload({ files: [f], altText: null, caption: null, actorId: input.actorId });
      if (outcome.kind === 'STORED') staged.push({ filename: f.filename, sha256: outcome.asset.checksum || sha256, assetId: outcome.asset.id, ready: true });
      else staged.push({ filename: f.filename, sha256, assetId: null, ready: false, rejectReason: describeUploadRejection(outcome.reason) });
    }
    // Readiness is what the gallery service will check at apply; confirm it now so the plan is honest.
    const ready = new Set((await this.galleryRepo.findReadyAssets(staged.map((s) => s.assetId).filter((a): a is string => !!a))).map((a) => a.id));
    for (const s of staged) if (s.assetId && !ready.has(s.assetId)) { s.ready = false; s.rejectReason = s.rejectReason ?? 'no display size could be made from this file'; }

    // 2. Resolve products and read each candidate gallery once.
    const products = await this.catalogue.listCodeIndex();
    const prelim = buildImportPlan({ files: staged, manifest: manifestRows, products, galleries: [] });
    const productIds = [...new Set(prelim.rows.map((r) => r.productId).filter((p): p is string => !!p))];
    const galleries: ProductGalleryContext[] = [];
    for (const productId of productIds) {
      const snap = await this.galleryRepo.getSnapshot(productId);
      if (!snap) continue;
      const currentMap = this.gallery.currentMap(snap);
      const assetHashes: Record<string, string> = {};
      for (const r of snap.rows) if (r.assetId && r.asset) assetHashes[r.assetId] = r.asset.checksum;
      galleries.push({ productId, sku: snap.sku, mediaRevision: snap.mediaRevision, currentMap, assetHashes });
    }
    const plan = buildImportPlan({ files: staged, manifest: manifestRows, products, galleries });
    const session = await this.repo.create({ name: input.name.trim().slice(0, 160) || `Image import ${new Date().toISOString().slice(0, 16)}`, plan, manifestSha256: manifestSha, manifestFilename: input.manifest?.filename ?? null, actorId: input.actorId });
    return { ok: true, session, plan, manifestErrors };
  }

  async approve(input: { id: string; expectedVersion: number; actorId: string; decision: 'APPROVED' | 'REJECTED'; reason: string }): Promise<{ ok: true; session: MediaImportSessionRecord } | MediaImportError> {
    const session = await this.repo.find(input.id);
    if (!session) return { ok: false, code: 'NOT_FOUND', message: 'Import session not found.' };
    if (session.createdBy === input.actorId) return { ok: false, code: 'FOUR_EYES_REQUIRED', message: 'The person who staged an import cannot approve it. A second person must review the plan.' };
    if (input.decision === 'APPROVED' && session.blocking) return { ok: false, code: 'PLAN_BLOCKED', message: 'The plan has blocking rows (unmatched, ambiguous, duplicate slot, invalid slot or invalid file). Fix the files and stage again.' };
    const updated = await this.repo.transition(input.id, input.expectedVersion, ['PLANNED'], input.decision === 'APPROVED'
      ? { status: 'APPROVED', approvedBy: input.actorId, approvedAt: new Date() }
      : { status: 'REJECTED', rejectedReason: input.reason.trim().slice(0, 500) || 'Rejected' });
    if (!updated) return { ok: false, code: 'STALE_VERSION', message: 'The session changed since you opened it. Reload and review again.' };
    return { ok: true, session: updated };
  }

  /** Apply (or resume) the approved plan: per-product transactions, a ledger, stop on the first unexpected failure. */
  async apply(input: { id: string; expectedVersion: number; actorId: string; resume?: boolean }): Promise<{ ok: true; session: MediaImportSessionRecord; summary: { applied: number; skipped: number; stale: number; failed: number; notAttempted: number } } | MediaImportError> {
    const session = await this.repo.find(input.id);
    if (!session) return { ok: false, code: 'NOT_FOUND', message: 'Import session not found.' };
    const from: Array<MediaImportSessionRecord['status']> = input.resume ? ['PARTIALLY_APPLIED', 'FAILED'] : ['APPROVED'];
    const started = await this.repo.transition(input.id, input.expectedVersion, from, { status: 'APPLYING', appliedBy: input.actorId });
    if (!started) return { ok: false, code: session.status === 'APPROVED' || from.includes(session.status) ? 'STALE_VERSION' : 'INVALID_STATE', message: session.status === 'APPLIED' ? 'This import has already been applied.' : `Apply needs an ${input.resume ? 'interrupted' : 'approved'} session at the version you opened (it is ${session.status}, version ${session.version}).` };

    const plans = await this.repo.productPlans(input.id);
    const rows = await this.repo.rows(input.id);
    const doneProducts = new Set(rows.filter((r) => r.applyStatus === 'APPLIED' || r.applyStatus === 'SKIPPED').map((r) => r.productId));
    const summary = { applied: 0, skipped: 0, stale: 0, failed: 0, notAttempted: 0 };
    let stop = false;
    for (const p of plans) {
      if (stop) { await this.repo.markRows(input.id, p.productId, { applyStatus: 'NOT_ATTEMPTED' }); summary.notAttempted += 1; continue; }
      if (doneProducts.has(p.productId)) { summary.skipped += 1; continue; }
      try {
        // Re-verify: revision and readiness are checked again inside replaceMap (locked); the plan hash covers the proposed maps.
        const r = await this.gallery.replaceMap({ productId: p.productId, expectedRevision: p.expectedRevision, map: p.proposedMap, actorId: input.actorId, action: `IMPORT:${input.id}` });
        if (r.ok) { await this.repo.markRows(input.id, p.productId, { applyStatus: 'APPLIED', appliedRevision: r.mediaRevision, appliedAt: new Date() }); summary.applied += 1; }
        else if (r.code === 'NOTHING_TO_DO') { await this.repo.markRows(input.id, p.productId, { applyStatus: 'SKIPPED', error: r.message }); summary.skipped += 1; }
        else if (r.code === 'STALE_REVISION') { await this.repo.markRows(input.id, p.productId, { applyStatus: 'STALE', error: r.message }); summary.stale += 1; }
        else { await this.repo.markRows(input.id, p.productId, { applyStatus: 'FAILED', error: `${r.code}: ${r.message}` }); summary.failed += 1; stop = true; }
      } catch (err) {
        await this.repo.markRows(input.id, p.productId, { applyStatus: 'FAILED', error: err instanceof Error ? err.message : String(err) });
        summary.failed += 1;
        stop = true;
      }
    }
    const status = summary.failed === 0 && summary.notAttempted === 0 && summary.stale === 0 ? 'APPLIED' : summary.applied + summary.skipped > 0 ? 'PARTIALLY_APPLIED' : 'FAILED';
    const finished = await this.repo.transition(input.id, started.version, ['APPLYING'], { status, appliedAt: new Date(), applySummary: { ...summary, at: new Date().toISOString(), resumed: Boolean(input.resume) } });
    return { ok: true, session: finished ?? started, summary };
  }

  /** Per-product results, CSV-safe cells are the route's job (csvCell). */
  async results(id: string): Promise<Array<Record<string, string | number | null>> | null> {
    const session = await this.repo.find(id);
    if (!session) return null;
    const rows = await this.repo.rows(id);
    return rows.map((r) => ({
      row: r.rowNumber, filename: r.filename, sha256: r.sha256, sku: r.productSku ?? r.skuToken, product_id: r.productId, slot: r.slot, role: r.role, plan_status: r.status,
      blocking: BLOCKING_STATUSES.has(r.status) ? 'yes' : 'no', issues: r.issues.join(' | '), expected_revision: r.expectedRevision, apply_status: r.applyStatus, applied_revision: r.appliedRevision, error: r.error,
    }));
  }

  static slotLabel(slot: GallerySlot | number | null): string {
    return slot === 1 ? 'Cover / Main' : slot === 2 ? 'Alternate' : slot === 3 ? 'Detail' : slot === 4 ? 'Context / Contents' : '';
  }
}
