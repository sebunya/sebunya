/**
 * Focus 4 — the product gallery's single authoritative state. Pure: no DOM,
 * no timers, no fetch. The component drives it with intents and load results;
 * this file decides what commits. Unit-tested for every race the brief names.
 *
 * Vocabulary
 *   available  the ordered media the server rendered (cover first). Identity is
 *              the media id, never an array index.
 *   active     what is displayed. Customer-local; never written to the server.
 *   pending    a requested target whose large rendition is still loading, with
 *              a generation number so only the latest still-relevant load commits.
 *   failed     transient load failures per media id: the item STAYS available
 *              (count unchanged) and offers retry; only authoritative removal
 *              takes it out of the list.
 */

export interface GalleryMedia {
  id: string;
  /** Large rendition the stage shows (pdp.webp). */
  src: string;
  srcset: string | null;
  /** Small rendition for the preview row (thumb.webp), or the large one when none exists. */
  thumb: string;
  alt: string;
  width: number;
  height: number;
}

export interface GalleryState {
  available: readonly GalleryMedia[];
  activeId: string;
  pending: { id: string; generation: number } | null;
  /** Media ids whose large rendition failed to load on the last attempt. */
  failedLarge: ReadonlySet<string>;
  /** Media ids whose thumbnail failed (independent of the large image). */
  failedThumb: ReadonlySet<string>;
  generation: number;
  /** Set once per successful user-driven commit; the component announces it and clears it. */
  announcement: string | null;
}

export type GalleryIntent =
  | { type: 'SELECT'; id: string }
  | { type: 'NEXT' }
  | { type: 'PREV' }
  | { type: 'FIRST' }
  | { type: 'LAST' }
  | { type: 'LOADED'; id: string; generation: number }
  | { type: 'FAILED'; id: string; generation: number }
  | { type: 'THUMB_FAILED'; id: string }
  | { type: 'THUMB_LOADED'; id: string }
  | { type: 'RETRY' }
  | { type: 'REMOVE_UNAVAILABLE'; id: string }
  | { type: 'RESET'; available: readonly GalleryMedia[]; activeId: string };

export interface GalleryEffect {
  /** Ask the component to load this media's large rendition and report LOADED/FAILED with the generation. */
  load?: { id: string; generation: number };
  /** True when the visible image just changed because of a user intent (announce, focus rules). */
  committed?: { id: string; ordinal: number; count: number };
  /** True when the available list changed (announce the new count once). */
  countChanged?: number;
}

export function createGalleryState(available: readonly GalleryMedia[], activeId?: string): GalleryState {
  const first = available[0]?.id ?? '';
  const active = activeId && available.some((m) => m.id === activeId) ? activeId : first;
  return { available, activeId: active, pending: null, failedLarge: new Set(), failedThumb: new Set(), generation: 0, announcement: null };
}

export function indexOf(state: GalleryState, id: string): number {
  return state.available.findIndex((m) => m.id === id);
}

/** 1-based position within the available list — never the canonical slot. */
export function ordinalOf(state: GalleryState, id: string): number {
  return indexOf(state, id) + 1;
}

export function activeMedia(state: GalleryState): GalleryMedia | null {
  return state.available.find((m) => m.id === state.activeId) ?? null;
}

/** Previews: every available item except the active one, canonical order preserved. */
export function previews(state: GalleryState): GalleryMedia[] {
  return state.available.filter((m) => m.id !== state.activeId);
}

/** The target the arrows step from: the latest requested target, or the active one. */
export function navigationAnchor(state: GalleryState): string {
  return state.pending?.id ?? state.activeId;
}

export function canGoPrev(state: GalleryState): boolean {
  return indexOf(state, navigationAnchor(state)) > 0;
}

export function canGoNext(state: GalleryState): boolean {
  const i = indexOf(state, navigationAnchor(state));
  return i >= 0 && i < state.available.length - 1;
}

function requestTarget(state: GalleryState, id: string): [GalleryState, GalleryEffect] {
  if (!state.available.some((m) => m.id === id)) return [state, {}];
  // Requesting the displayed image: a no-op only when nothing different is pending.
  // If something IS pending, the newest intent wins: cancel it and keep the displayed image.
  if (id === state.activeId) {
    if (!state.pending) return [state, {}];
    return [{ ...state, pending: null, generation: state.generation + 1 }, {}];
  }
  if (state.pending?.id === id) return [state, {}];
  const generation = state.generation + 1;
  return [{ ...state, pending: { id, generation }, generation }, { load: { id, generation } }];
}

export function reduce(state: GalleryState, intent: GalleryIntent): [GalleryState, GalleryEffect] {
  switch (intent.type) {
    case 'SELECT':
      return requestTarget(state, intent.id);
    case 'NEXT': {
      const i = indexOf(state, navigationAnchor(state));
      const next = state.available[i + 1];
      return next ? requestTarget(state, next.id) : [state, {}];
    }
    case 'PREV': {
      const i = indexOf(state, navigationAnchor(state));
      const prev = i > 0 ? state.available[i - 1] : undefined;
      return prev ? requestTarget(state, prev.id) : [state, {}];
    }
    case 'FIRST':
      return state.available[0] ? requestTarget(state, state.available[0].id) : [state, {}];
    case 'LAST':
      return state.available.length ? requestTarget(state, state.available[state.available.length - 1].id) : [state, {}];
    case 'LOADED': {
      // Only the latest still-relevant request may commit.
      if (!state.pending || state.pending.id !== intent.id || state.pending.generation !== intent.generation) return [state, {}];
      const failedLarge = new Set(state.failedLarge);
      failedLarge.delete(intent.id);
      const next: GalleryState = { ...state, activeId: intent.id, pending: null, failedLarge, announcement: `Image ${ordinalOf(state, intent.id)} of ${state.available.length}` };
      return [next, { committed: { id: intent.id, ordinal: ordinalOf(state, intent.id), count: state.available.length } }];
    }
    case 'FAILED': {
      if (!state.pending || state.pending.id !== intent.id || state.pending.generation !== intent.generation) return [state, {}];
      const failedLarge = new Set(state.failedLarge);
      failedLarge.add(intent.id);
      // Keep the previous image; the item stays in the list and offers retry.
      return [{ ...state, pending: null, failedLarge }, {}];
    }
    case 'THUMB_FAILED': {
      const failedThumb = new Set(state.failedThumb);
      failedThumb.add(intent.id);
      return [{ ...state, failedThumb }, {}];
    }
    case 'THUMB_LOADED': {
      if (!state.failedThumb.has(intent.id)) return [state, {}];
      const failedThumb = new Set(state.failedThumb);
      failedThumb.delete(intent.id);
      return [{ ...state, failedThumb }, {}];
    }
    case 'RETRY': {
      // Retry the last failed target the visitor asked for, if any.
      const last = [...state.failedLarge].pop();
      return last ? requestTarget(state, last) : [state, {}];
    }
    case 'REMOVE_UNAVAILABLE': {
      // Authoritative unavailability only (the server said so), never a browser failure.
      if (!state.available.some((m) => m.id === intent.id)) return [state, {}];
      const available = state.available.filter((m) => m.id !== intent.id);
      const activeId = state.activeId === intent.id ? (available[0]?.id ?? '') : state.activeId;
      const pending = state.pending?.id === intent.id ? null : state.pending;
      return [{ ...state, available, activeId, pending, generation: state.generation + 1 }, { countChanged: available.length }];
    }
    case 'RESET':
      // Product/variant identity changed: nothing pending may commit into the new gallery.
      return [createGalleryState(intent.available, intent.activeId), {}];
    default:
      return [state, {}];
  }
}

export function clearAnnouncement(state: GalleryState): GalleryState {
  return state.announcement === null ? state : { ...state, announcement: null };
}
