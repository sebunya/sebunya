import { resolveGallery, type GallerySlot } from '@goldplus/shared';
import {
  applySlotAction,
  completeness,
  slotMapsEqual,
  validateSlotMap,
  type SlotAssignment,
  type SlotMap,
  type SlotMapAction,
  type SlotMapErrorCode,
} from '../../../domain/media/ProductMediaSlotMap';
import type { IProductMediaRepository, ProductMediaSnapshot } from '../../ports/IProductMediaRepository';

/**
 * Focus 4 — the application service every gallery write goes through: the
 * admin editor, the reviewed import, the backfill and the legacy image routes.
 *
 * Reads are pure. A write is: current map (from the snapshot) + one action →
 * proposed complete map → structural validation against the ready-asset set →
 * one atomic, revision-checked repository call. Nothing here touches the
 * customer's transient "active image"; that never reaches the server.
 */

export type ProductMediaError =
  | { ok: false; code: 'NOT_FOUND'; message: string }
  | { ok: false; code: 'STALE_REVISION'; message: string; currentRevision: number }
  | { ok: false; code: SlotMapErrorCode; message: string };

export interface GalleryView {
  productId: string;
  sku: string;
  name: string;
  slug: string;
  mediaRevision: number;
  migrated: boolean;
  missingCover: boolean;
  completeness: { assigned: number; label: string; hasCover: boolean };
  slots: Array<{
    slot: GallerySlot;
    imageId: string | null;
    assetId: string | null;
    url: string | null;
    displayUrl: string | null;
    thumbUrl: string | null;
    altText: string | null;
    assetAlt: string | null;
    filename: string | null;
    width: number | null;
    height: number | null;
    byteSize: number | null;
    ready: boolean;
  }>;
  /** Rows the gallery does not show: legacy rows (no slot) on a migrated product, or unready assets. */
  legacyRows: Array<{ imageId: string; assetId: string | null; url: string; isPrimary: boolean; displayOrder: number; reason: string }>;
}

export type MutateResult = { ok: true; mediaRevision: number; map: SlotAssignment[]; coverChanged: boolean } | ProductMediaError;

export class ProductMediaUseCases {
  constructor(private readonly repo: IProductMediaRepository) {}

  async getGallery(productId: string): Promise<GalleryView | null> {
    const snap = await this.repo.getSnapshot(productId);
    if (!snap) return null;
    return toGalleryView(snap);
  }

  /** The current canonical map (empty for an unmigrated product — its legacy rows are not a map). */
  currentMap(snap: ProductMediaSnapshot): SlotMap {
    return snap.rows
      .filter((r): r is typeof r & { slot: GallerySlot; assetId: string } => r.slot !== null && r.assetId !== null)
      .map((r) => ({ slot: r.slot, assetId: r.assetId, altText: r.altText }))
      .sort((a, b) => a.slot - b.slot);
  }

  async mutate(input: { productId: string; expectedRevision: number; action: SlotMapAction; actorId: string; requestId?: string | null }): Promise<MutateResult> {
    const snap = await this.repo.getSnapshot(input.productId);
    if (!snap) return { ok: false, code: 'NOT_FOUND', message: 'Product not found.' };
    if (snap.mediaRevision !== input.expectedRevision) {
      return { ok: false, code: 'STALE_REVISION', message: 'Someone changed this gallery after you opened it. Review the current images and try again.', currentRevision: snap.mediaRevision };
    }
    const current = this.currentMap(snap);
    const proposed = applySlotAction(current, input.action);
    if (!proposed.ok) return proposed;
    return this.commit(snap, current, proposed.map, input.action.type, input.actorId, input.requestId ?? null);
  }

  /** Write a complete map (import apply, backfill, undo). Same validation, same atomic write. */
  async replaceMap(input: { productId: string; expectedRevision: number; map: SlotMap; actorId: string; action?: string; requestId?: string | null }): Promise<MutateResult> {
    const snap = await this.repo.getSnapshot(input.productId);
    if (!snap) return { ok: false, code: 'NOT_FOUND', message: 'Product not found.' };
    if (snap.mediaRevision !== input.expectedRevision) {
      return { ok: false, code: 'STALE_REVISION', message: 'The gallery changed since this plan was made. Re-plan before applying.', currentRevision: snap.mediaRevision };
    }
    const current = this.currentMap(snap);
    return this.commit(snap, current, input.map, input.action ?? 'RESTORE', input.actorId, input.requestId ?? null);
  }

  private async commit(snap: ProductMediaSnapshot, current: SlotMap, proposed: SlotMap, action: string, actorId: string, requestId: string | null): Promise<MutateResult> {
    const ready = await this.repo.findReadyAssets(proposed.map((a) => a.assetId));
    const validated = validateSlotMap(proposed, new Set(ready.map((a) => a.id)));
    if (!validated.ok) return validated;
    if (slotMapsEqual(current, validated.map) && snap.mediaRevision > 0) {
      return { ok: false, code: 'NOTHING_TO_DO', message: 'Nothing changed.' };
    }
    const result = await this.repo.applySlotMap(snap.productId, snap.mediaRevision, validated.map, { actorId, action, previousMap: current, requestId });
    if (result.kind === 'STALE') return { ok: false, code: 'STALE_REVISION', message: 'Someone changed this gallery a moment ago. Review the current images and try again.', currentRevision: result.currentRevision };
    if (result.kind === 'NOT_FOUND') return { ok: false, code: 'NOT_FOUND', message: 'Product not found.' };
    const coverBefore = current.find((a) => a.slot === 1)?.assetId ?? null;
    const coverAfter = result.map.find((a) => a.slot === 1)?.assetId ?? null;
    return { ok: true, mediaRevision: result.mediaRevision, map: result.map, coverChanged: coverBefore !== coverAfter };
  }

  /**
   * "Make this asset the cover" for the legacy callers (media library assign,
   * battery evidence, photos-by-code): already in the gallery → swap into slot 1;
   * slot 1 empty → assign it; otherwise an atomic cover replacement. Never a
   * silent promotion, never a second primary.
   */
  async assignAsCover(input: { productId: string; assetId: string; actorId: string; requestId?: string | null }): Promise<MutateResult> {
    const snap = await this.repo.getSnapshot(input.productId);
    if (!snap) return { ok: false, code: 'NOT_FOUND', message: 'Product not found.' };
    const current = this.currentMap(snap);
    const inGallery = current.find((a) => a.assetId === input.assetId);
    const action: SlotMapAction = inGallery
      ? { type: 'SET_COVER', assetId: input.assetId }
      : current.some((a) => a.slot === 1)
        ? { type: 'REMOVE', slot: 1, replacementAssetId: input.assetId }
        : { type: 'ASSIGN', slot: 1, assetId: input.assetId };
    const r = await this.mutate({ productId: input.productId, expectedRevision: snap.mediaRevision, action, actorId: input.actorId, requestId: input.requestId });
    if (!r.ok && r.code === 'NOTHING_TO_DO') return { ok: true, mediaRevision: snap.mediaRevision, map: [...current], coverChanged: false };
    return r;
  }

  /** Place an asset in the first empty slot (cover first when the gallery is empty). Full gallery → GALLERY_FULL-style refusal via INVALID_SLOT. */
  async assignNextFree(input: { productId: string; assetId: string; actorId: string; altText?: string | null; requestId?: string | null }): Promise<MutateResult> {
    const snap = await this.repo.getSnapshot(input.productId);
    if (!snap) return { ok: false, code: 'NOT_FOUND', message: 'Product not found.' };
    const current = this.currentMap(snap);
    if (current.some((a) => a.assetId === input.assetId)) return { ok: false, code: 'DUPLICATE_ASSET', message: 'That image is already in this gallery.' };
    const taken = new Set(current.map((a) => a.slot));
    const free = ([1, 2, 3, 4] as GallerySlot[]).find((s) => !taken.has(s));
    if (!free) return { ok: false, code: 'INVALID_SLOT', message: 'This gallery already holds four images (4/4). Replace or remove one first.' };
    return this.mutate({ productId: input.productId, expectedRevision: snap.mediaRevision, action: { type: 'ASSIGN', slot: free, assetId: input.assetId, altText: input.altText ?? null }, actorId: input.actorId, requestId: input.requestId });
  }

  /** Remove by gallery row id (the legacy DELETE route). A slotted cover needs a replacement; a legacy (unslotted) row may simply go. */
  async removeImage(input: { productId: string; imageId: string; actorId: string }): Promise<MutateResult | { ok: true; legacyRowRemoved: true }> {
    const snap = await this.repo.getSnapshot(input.productId);
    if (!snap) return { ok: false, code: 'NOT_FOUND', message: 'Product not found.' };
    const row = snap.rows.find((r) => r.imageId === input.imageId);
    if (!row) return { ok: false, code: 'NOT_FOUND', message: 'Image not found.' };
    if (row.slot === null) return { ok: true, legacyRowRemoved: true };
    return this.mutate({ productId: input.productId, expectedRevision: snap.mediaRevision, action: { type: 'REMOVE', slot: row.slot }, actorId: input.actorId });
  }

  /** Undo = restore a recorded prior map as a NEW revision-checked write. Never overwrites a colleague's later edit. */
  async undo(input: { productId: string; expectedRevision: number; auditId: string; actorId: string }): Promise<MutateResult> {
    const history = await this.repo.listGalleryAudit(input.productId, 50);
    const entry = history.find((h) => h.id === input.auditId);
    if (!entry) return { ok: false, code: 'NOT_FOUND', message: 'That gallery change is not in the recent history.' };
    return this.replaceMap({ productId: input.productId, expectedRevision: input.expectedRevision, map: entry.previousMap, actorId: input.actorId, action: `UNDO:${entry.action}` });
  }

  async history(productId: string, limit = 20) {
    return this.repo.listGalleryAudit(productId, limit);
  }
}

export function toGalleryView(snap: ProductMediaSnapshot): GalleryView {
  const resolved = resolveGallery(snap.rows.map((r) => ({ ...r, slot: r.slot })));
  const bySlot = new Map<number, (typeof snap.rows)[number]>();
  for (const r of snap.rows) if (r.slot !== null) bySlot.set(r.slot, r);
  const slots = ([1, 2, 3, 4] as GallerySlot[]).map((slot) => {
    const r = bySlot.get(slot) ?? null;
    return {
      slot,
      imageId: r?.imageId ?? null,
      assetId: r?.assetId ?? null,
      url: r?.url ?? null,
      displayUrl: r?.asset?.displayUrl ?? r?.url ?? null,
      thumbUrl: r?.asset?.thumbUrl ?? null,
      altText: r?.altText ?? null,
      assetAlt: null,
      filename: r?.asset?.filename ?? null,
      width: r?.asset?.width ?? null,
      height: r?.asset?.height ?? null,
      byteSize: r?.asset?.byteSize ?? null,
      ready: r?.asset?.ready ?? false,
    };
  });
  const map: SlotMap = snap.rows.filter((r) => r.slot !== null && r.assetId !== null).map((r) => ({ slot: r.slot as GallerySlot, assetId: r.assetId as string, altText: r.altText }));
  const legacyRows = snap.rows
    .filter((r) => r.slot === null)
    .map((r) => ({
      imageId: r.imageId,
      assetId: r.assetId,
      url: r.url,
      isPrimary: r.isPrimary,
      displayOrder: r.displayOrder,
      reason: r.assetId === null ? 'Legacy URL-only image: no library asset, no renditions. Re-upload through the library to place it in a slot.' : r.asset?.ready ? (resolved.migrated ? 'Not placed in a slot.' : 'Awaiting backfill into slot 1.') : 'Asset is not ready (archived, missing file or no rendition).',
    }));
  return {
    productId: snap.productId,
    sku: snap.sku,
    name: snap.name,
    slug: snap.slug,
    mediaRevision: snap.mediaRevision,
    migrated: resolved.migrated,
    missingCover: resolved.missingCover,
    completeness: completeness(map),
    slots,
    legacyRows,
  };
}
