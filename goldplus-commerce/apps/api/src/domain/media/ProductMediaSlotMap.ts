import { GALLERY_MAX_SLOTS, isGallerySlot, type GallerySlot } from '@goldplus/shared';

/**
 * Focus 4 — the slot map and every admin mutation on it. Pure domain: no I/O,
 * no framework. The infrastructure applies a validated map atomically; this
 * file decides what the new map IS and refuses what the brief forbids.
 *
 * A slot map is sparse: fixed positions 1–4, never compacted. Removing slot 2
 * leaves 1, 3 and 4 where they are.
 */

export interface SlotAssignment {
  slot: GallerySlot;
  assetId: string;
  /** Truthful contextual override; null = the asset's own alt text. */
  altText: string | null;
}

export type SlotMap = readonly SlotAssignment[];

export type SlotMapAction =
  | { type: 'ASSIGN'; slot: GallerySlot; assetId: string; altText?: string | null }
  | { type: 'REPLACE'; slot: GallerySlot; assetId: string; altText?: string | null }
  | { type: 'SET_COVER'; assetId: string }
  | { type: 'REMOVE'; slot: GallerySlot; replacementAssetId?: string | null; allowClearLastCover?: boolean }
  | { type: 'MOVE'; from: GallerySlot; to: GallerySlot }
  | { type: 'SET_ALT'; slot: GallerySlot; altText: string | null }
  | { type: 'RESTORE'; map: SlotMap };

export type SlotMapErrorCode =
  | 'INVALID_SLOT'
  | 'DUPLICATE_SLOT'
  | 'DUPLICATE_ASSET'
  | 'ASSET_NOT_READY'
  | 'SLOT_EMPTY'
  | 'SLOT_OCCUPIED'
  | 'ASSET_NOT_IN_GALLERY'
  | 'COVER_REQUIRES_REPLACEMENT'
  | 'NOTHING_TO_DO';

export type SlotMapResult =
  | { ok: true; map: SlotMap; coverChanged: boolean }
  | { ok: false; code: SlotMapErrorCode; message: string };

const ALT_MAX = 255;

function fail(code: SlotMapErrorCode, message: string): SlotMapResult {
  return { ok: false, code, message };
}

function sortMap(map: readonly SlotAssignment[]): SlotAssignment[] {
  return [...map].sort((a, b) => a.slot - b.slot);
}

export function normaliseAlt(alt: string | null | undefined): string | null {
  if (alt == null) return null;
  const trimmed = alt.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return trimmed ? trimmed.slice(0, ALT_MAX) : null;
}

/**
 * Structural validation of a complete proposed map: legal slots, no duplicate
 * slot, no duplicate asset, every asset READY (caller supplies the ready set —
 * ACTIVE, file present, storefront rendition generated).
 */
export function validateSlotMap(map: readonly SlotAssignment[], readyAssetIds: ReadonlySet<string>): SlotMapResult {
  const seenSlots = new Set<number>();
  const seenAssets = new Set<string>();
  for (const a of map) {
    if (!isGallerySlot(a.slot)) return fail('INVALID_SLOT', `Slot ${String(a.slot)} is not allowed. Slots are 1 to ${GALLERY_MAX_SLOTS}.`);
    if (seenSlots.has(a.slot)) return fail('DUPLICATE_SLOT', `Slot ${a.slot} is assigned twice.`);
    seenSlots.add(a.slot);
    if (!a.assetId || typeof a.assetId !== 'string') return fail('ASSET_NOT_READY', 'An assignment names no asset.');
    if (seenAssets.has(a.assetId)) return fail('DUPLICATE_ASSET', 'The same image cannot fill two slots of one product.');
    seenAssets.add(a.assetId);
    if (!readyAssetIds.has(a.assetId)) return fail('ASSET_NOT_READY', 'Only a ready, validated library image can be placed in the gallery.');
  }
  return { ok: true, map: sortMap(map.map((a) => ({ slot: a.slot, assetId: a.assetId, altText: normaliseAlt(a.altText) }))), coverChanged: false };
}

/** Apply one admin action to the current map. The result is a complete proposed map, not a diff. */
export function applySlotAction(current: SlotMap, action: SlotMapAction): SlotMapResult {
  const bySlot = new Map<number, SlotAssignment>(current.map((a) => [a.slot, a]));
  const coverBefore = bySlot.get(1)?.assetId ?? null;
  const done = (next: SlotAssignment[]): SlotMapResult => {
    const map = sortMap(next);
    const coverAfter = map.find((a) => a.slot === 1)?.assetId ?? null;
    return { ok: true, map, coverChanged: coverBefore !== coverAfter };
  };

  switch (action.type) {
    case 'ASSIGN': {
      if (!isGallerySlot(action.slot)) return fail('INVALID_SLOT', 'Slots are 1 to 4.');
      if (bySlot.has(action.slot)) return fail('SLOT_OCCUPIED', `Slot ${action.slot} already holds an image. Use Replace.`);
      if (current.some((a) => a.assetId === action.assetId)) return fail('DUPLICATE_ASSET', 'That image is already in this gallery.');
      return done([...current, { slot: action.slot, assetId: action.assetId, altText: normaliseAlt(action.altText) }]);
    }
    case 'REPLACE': {
      if (!isGallerySlot(action.slot)) return fail('INVALID_SLOT', 'Slots are 1 to 4.');
      const target = bySlot.get(action.slot);
      if (!target) return fail('SLOT_EMPTY', `Slot ${action.slot} is empty. Use Assign.`);
      if (current.some((a) => a.assetId === action.assetId && a.slot !== action.slot)) return fail('DUPLICATE_ASSET', 'That image is already in another slot.');
      if (target.assetId === action.assetId && action.altText === undefined) return fail('NOTHING_TO_DO', 'That slot already shows this image.');
      return done(current.map((a) => (a.slot === action.slot ? { slot: a.slot, assetId: action.assetId, altText: action.altText === undefined ? a.altText : normaliseAlt(action.altText) } : a)));
    }
    case 'SET_COVER': {
      const chosen = current.find((a) => a.assetId === action.assetId);
      if (!chosen) return fail('ASSET_NOT_IN_GALLERY', 'Choose an image that is already in the gallery, or assign it to slot 1.');
      if (chosen.slot === 1) return fail('NOTHING_TO_DO', 'That image is already the cover.');
      const cover = bySlot.get(1);
      // Swap with slot 1; if slot 1 is empty (legacy/draft), move the chosen image there and leave its old slot empty.
      return done(
        current.map((a) => {
          if (a.slot === chosen.slot) return { ...a, slot: 1 as GallerySlot };
          if (cover && a.slot === 1) return { ...a, slot: chosen.slot };
          return a;
        }),
      );
    }
    case 'REMOVE': {
      if (!isGallerySlot(action.slot)) return fail('INVALID_SLOT', 'Slots are 1 to 4.');
      const target = bySlot.get(action.slot);
      if (!target) return fail('SLOT_EMPTY', `Slot ${action.slot} is already empty.`);
      if (action.slot !== 1) return done(current.filter((a) => a.slot !== action.slot));
      // Removing the cover: never silently promote another image.
      if (action.replacementAssetId) {
        const replacement = action.replacementAssetId;
        if (current.some((a) => a.assetId === replacement && a.slot !== 1)) return fail('DUPLICATE_ASSET', 'The replacement is already in another slot. Use Set as cover instead.');
        return done(current.map((a) => (a.slot === 1 ? { slot: 1 as GallerySlot, assetId: replacement, altText: null } : a)));
      }
      if (!action.allowClearLastCover) {
        return fail('COVER_REQUIRES_REPLACEMENT', 'The cover cannot be removed without a replacement: cards, search, cart and social previews all use it. Choose a replacement image or use Set as cover.');
      }
      return done(current.filter((a) => a.slot !== 1));
    }
    case 'MOVE': {
      if (!isGallerySlot(action.from) || !isGallerySlot(action.to)) return fail('INVALID_SLOT', 'Slots are 1 to 4.');
      if (action.from === action.to) return fail('NOTHING_TO_DO', 'The image is already in that slot.');
      const moving = bySlot.get(action.from);
      if (!moving) return fail('SLOT_EMPTY', `Slot ${action.from} is empty.`);
      const occupant = bySlot.get(action.to);
      return done(
        current.map((a) => {
          if (a.slot === action.from) return { ...a, slot: action.to };
          if (occupant && a.slot === action.to) return { ...a, slot: action.from };
          return a;
        }),
      );
    }
    case 'SET_ALT': {
      const target = bySlot.get(action.slot);
      if (!target) return fail('SLOT_EMPTY', `Slot ${action.slot} is empty.`);
      return done(current.map((a) => (a.slot === action.slot ? { ...a, altText: normaliseAlt(action.altText) } : a)));
    }
    case 'RESTORE': {
      // Undo is "restore this recorded map as a new revision-checked write"; the map is validated by the caller.
      return done(action.map.map((a) => ({ slot: a.slot, assetId: a.assetId, altText: normaliseAlt(a.altText) })));
    }
    default:
      return fail('NOTHING_TO_DO', 'Unknown action.');
  }
}

/** Ordered list of assignments (cover first); the customer counter is the index + 1, never the slot. */
export function orderedAssignments(map: SlotMap): SlotAssignment[] {
  return sortMap(map);
}

export function slotMapsEqual(a: SlotMap, b: SlotMap): boolean {
  const sa = sortMap(a);
  const sb = sortMap(b);
  return sa.length === sb.length && sa.every((x, i) => x.slot === sb[i].slot && x.assetId === sb[i].assetId && (x.altText ?? null) === (sb[i].altText ?? null));
}

/** Completeness label used by the queue: 0/4 … 4/4. One image is functional; four is media-complete, not a quality score. */
export function completeness(map: SlotMap): { assigned: number; label: string; hasCover: boolean } {
  const assigned = map.length;
  return { assigned, label: `${assigned}/${GALLERY_MAX_SLOTS}`, hasCover: map.some((a) => a.slot === 1) };
}
