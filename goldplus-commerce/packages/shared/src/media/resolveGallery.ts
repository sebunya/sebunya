/**
 * Focus 4 — THE cover resolver.
 *
 * One decision for every reader (PDP, cards, search, rails, feeds, admin):
 *
 *   1. If the product has any row with a canonical `slot`, the gallery is
 *      exactly those rows in slot order and the cover is slot 1. Rows with a
 *      NULL slot are legacy leftovers and are NOT shown.
 *   2. Otherwise the product has not been migrated yet: fall back to the
 *      historical `is_primary DESC, display_order ASC` order (a controlled
 *      legacy fallback, reported as `migrated: false` so its use can be measured).
 *   3. No rows → no cover. The caller keeps its existing neutral fallback.
 *
 * Nothing here infers a cover from filenames, upload order or row order, and
 * nothing here writes. Pure, dependency-free, shared by the API and the web app.
 */

export const GALLERY_MAX_SLOTS = 4 as const;
export type GallerySlot = 1 | 2 | 3 | 4;

export const GALLERY_SLOT_ROLES: Record<GallerySlot, { name: string; question: string }> = {
  1: { name: 'Cover / Main', question: 'What exactly am I buying?' },
  2: { name: 'Alternate', question: 'What cannot I see from the cover?' },
  3: { name: 'Detail', question: 'Will this fit or work for me?' },
  4: { name: 'Context / Contents', question: 'How big is it, or what is included?' },
};

export interface GalleryRowLike {
  slot: number | null;
  isPrimary: boolean;
  displayOrder: number;
}

export interface ResolvedGallery<T extends GalleryRowLike> {
  /** Slot 1 (or the legacy primary for an unmigrated product). */
  cover: T | null;
  /** Canonical order, cover first. For a migrated product: slot order, sparse slots skipped. */
  ordered: T[];
  /** True when the order came from canonical slots; false = legacy fallback in use. */
  migrated: boolean;
  /** Slot 1 absent although other slots exist — an operational issue, never silently repaired here. */
  missingCover: boolean;
}

export function isGallerySlot(value: unknown): value is GallerySlot {
  return value === 1 || value === 2 || value === 3 || value === 4;
}

export function resolveGallery<T extends GalleryRowLike>(rows: readonly T[]): ResolvedGallery<T> {
  const slotted = rows.filter((r) => isGallerySlot(r.slot));
  if (slotted.length > 0) {
    const ordered = [...slotted].sort((a, b) => (a.slot as number) - (b.slot as number));
    const cover = ordered.find((r) => r.slot === 1) ?? null;
    return { cover, ordered, migrated: true, missingCover: cover === null };
  }
  if (rows.length === 0) return { cover: null, ordered: [], migrated: false, missingCover: false };
  const ordered = [...rows].sort((a, b) =>
    a.isPrimary === b.isPrimary ? a.displayOrder - b.displayOrder : a.isPrimary ? -1 : 1,
  );
  return { cover: ordered[0] ?? null, ordered, migrated: false, missingCover: false };
}

/** Customer-facing ordinal (1-based position within the available list), never the raw slot. */
export function galleryOrdinal<T extends GalleryRowLike>(ordered: readonly T[], row: T): number {
  return ordered.indexOf(row) + 1;
}
