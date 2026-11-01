import type { GallerySlot } from '@goldplus/shared';
import type { SlotAssignment } from './ProductMediaSlotMap';

/**
 * Focus 4 — backfill planner (pure). For one product that has legacy rows and
 * no slots yet, decide what slot 1 (and only slot 1) should be.
 *
 * Rules, in the order the brief states them:
 *  - only a VERIFIED current canonical image is backfilled: a row with a ready
 *    library asset (ACTIVE, rendition generated) that the legacy order calls the
 *    primary. Nothing else is invented: supporting slots stay empty.
 *  - a product an operator has already edited through the gallery service
 *    (media_revision > 0, or any slotted row) is never touched on rerun.
 *  - a legacy primary without a ready asset (URL-only upload, archived asset,
 *    missing rendition) is a CONFLICT to report, not a row to promote.
 *  - two rows flagged primary is a conflict too: the planner will not guess.
 */

export interface BackfillRow {
  imageId: string;
  assetId: string | null;
  slot: number | null;
  isPrimary: boolean;
  displayOrder: number;
  altText: string | null;
  assetReady: boolean;
}

export type BackfillDecision =
  | { kind: 'SKIP_ALREADY_MIGRATED'; reason: string }
  | { kind: 'SKIP_NO_ROWS' }
  | { kind: 'CONFLICT'; code: 'NO_READY_ASSET' | 'MULTIPLE_PRIMARIES' | 'LEGACY_URL_ONLY'; reason: string }
  | { kind: 'ASSIGN_COVER'; map: SlotAssignment[]; sourceImageId: string };

export function planBackfill(product: { mediaRevision: number }, rows: readonly BackfillRow[]): BackfillDecision {
  if (product.mediaRevision > 0 || rows.some((r) => r.slot !== null)) {
    return { kind: 'SKIP_ALREADY_MIGRATED', reason: 'The gallery has been written through the mutation service; the operator\'s state wins.' };
  }
  if (rows.length === 0) return { kind: 'SKIP_NO_ROWS' };
  const primaries = rows.filter((r) => r.isPrimary);
  if (primaries.length > 1) {
    return { kind: 'CONFLICT', code: 'MULTIPLE_PRIMARIES', reason: `${primaries.length} rows are flagged primary; a person must choose the cover.` };
  }
  const ordered = [...rows].sort((a, b) => (a.isPrimary === b.isPrimary ? a.displayOrder - b.displayOrder : a.isPrimary ? -1 : 1));
  const legacyCover = ordered[0];
  if (!legacyCover.assetId) {
    return { kind: 'CONFLICT', code: 'LEGACY_URL_ONLY', reason: 'The current primary is a URL-only legacy image with no library asset; re-upload it through the library to give it a slot.' };
  }
  if (!legacyCover.assetReady) {
    return { kind: 'CONFLICT', code: 'NO_READY_ASSET', reason: 'The current primary\'s asset is archived, missing on disk or has no rendition; repair it before it can become slot 1.' };
  }
  return {
    kind: 'ASSIGN_COVER',
    sourceImageId: legacyCover.imageId,
    map: [{ slot: 1 as GallerySlot, assetId: legacyCover.assetId, altText: legacyCover.altText }],
  };
}
