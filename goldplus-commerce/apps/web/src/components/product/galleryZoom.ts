/**
 * Gallery zoom (2026-09-24): a click or tap on the stage image opens it full
 * size in a native <dialog>. The stage also takes a horizontal swipe to change
 * image, so a pointer sequence that MOVED is a swipe (or a scroll), never a
 * request to enlarge. Pure so the rule is unit-tested outside the browser.
 */

/** Movement (px) past which a touch sequence is a gesture, not a tap. */
export const ZOOM_TAP_SLOP_PX = 10;

export interface Point {
  x: number;
  y: number;
}

/** True only when the pointer barely moved between down and up: a tap/click. */
export function isZoomTap(start: Point | null, end: Point): boolean {
  if (!start) return true; // a mouse click or keyboard activation has no touch start
  return Math.abs(end.x - start.x) <= ZOOM_TAP_SLOP_PX && Math.abs(end.y - start.y) <= ZOOM_TAP_SLOP_PX;
}

/**
 * The image to enlarge: the stage image's own `src` (the 1024px master the
 * srcset tops out at), never an arbitrary URL. Empty when there is nothing safe.
 */
export function zoomSourceOf(src: string | null | undefined): string {
  const candidate = String(src ?? '').trim();
  return /^https?:\/\//i.test(candidate) || /^\/(?!\/)/.test(candidate) ? candidate : '';
}
