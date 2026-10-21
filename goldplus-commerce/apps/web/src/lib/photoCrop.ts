/**
 * 0201: the geometry of placing a photo in a square (the buy page's cropper), with no DOM in it so it can be tested.
 *
 * The state is in the photo's own pixels: the point at the centre of the square, and the zoom. The frame's size on
 * screen only enters when something is drawn or a finger moves, so turning the phone or resizing the window never
 * shifts the crop, and what the frame shows is exactly the square that is uploaded.
 *
 * zoom 1: the photo's shorter side just fills the square. zoom 3: three times closer.
 */
export const CROP_ZOOM = Object.freeze({ min: 1, max: 3 });
/** The upload: a square of at most this many pixels a side, and never fewer (the API's smallest printable photo). */
export const CROP_OUTPUT = Object.freeze({ max: 1080, min: 200 });

export interface PhotoCrop {
  /** The photo's natural size. */
  width: number;
  height: number;
  /** The point at the centre of the square, in the photo's pixels. */
  cx: number;
  cy: number;
  zoom: number;
}

/** The square's side, in the photo's pixels. */
export const cropSide = (c: Pick<PhotoCrop, 'width' | 'height' | 'zoom'>) => Math.min(c.width, c.height) / c.zoom;

const clampZoom = (z: number) => Math.min(CROP_ZOOM.max, Math.max(CROP_ZOOM.min, Number.isFinite(z) ? z : CROP_ZOOM.min));

/** Never a gap: the square always lies inside the photo. */
export function clampCrop(c: PhotoCrop): PhotoCrop {
  const zoom = clampZoom(c.zoom);
  const half = cropSide({ ...c, zoom }) / 2;
  return {
    ...c,
    zoom,
    cx: Math.min(c.width - half, Math.max(half, c.cx)),
    cy: Math.min(c.height - half, Math.max(half, c.cy)),
  };
}

/** A new photo: centred, zoom 1. */
export const initialCrop = (width: number, height: number): PhotoCrop => clampCrop({ width, height, cx: width / 2, cy: height / 2, zoom: CROP_ZOOM.min });

/** Screen pixels per photo pixel, for a frame `frame` pixels wide. */
export const cropScale = (c: PhotoCrop, frame: number) => frame / cropSide(c);

/** Move the photo by (dx, dy) screen pixels, as a finger or an arrow key does. */
export function panCrop(c: PhotoCrop, dx: number, dy: number, frame: number): PhotoCrop {
  const s = cropScale(c, frame);
  return clampCrop({ ...c, cx: c.cx - dx / s, cy: c.cy - dy / s });
}

/**
 * Zoom to `zoom` about the point (fx, fy) of the frame (its centre when not given): the part of the photo under that
 * point stays under it, unless the square would leave the photo.
 */
export function zoomCrop(c: PhotoCrop, zoom: number, frame: number, fx = frame / 2, fy = frame / 2): PhotoCrop {
  const before = cropScale(c, frame);
  const px = c.cx + (fx - frame / 2) / before; // the photo point under the focus
  const py = c.cy + (fy - frame / 2) / before;
  const next = { ...c, zoom: clampZoom(zoom) };
  const after = cropScale(next, frame);
  return clampCrop({ ...next, cx: px - (fx - frame / 2) / after, cy: py - (fy - frame / 2) / after });
}

/** How to show the photo in the frame: CSS `translate(x, y) scale(scale)` with the image's origin at its top left. */
export function cropTransform(c: PhotoCrop, frame: number): { x: number; y: number; scale: number } {
  const scale = cropScale(c, frame);
  return { x: frame / 2 - c.cx * scale, y: frame / 2 - c.cy * scale, scale };
}

/**
 * The upload: the square in the photo's pixels (for canvas drawImage) and the size to draw it at. A photo smaller than
 * the smallest printable square is drawn up to it rather than refused here (the API decides what it can print).
 */
export function cropSource(c: PhotoCrop): { sx: number; sy: number; side: number; out: number } {
  const side = cropSide(c);
  return { sx: c.cx - side / 2, sy: c.cy - side / 2, side, out: Math.max(CROP_OUTPUT.min, Math.min(CROP_OUTPUT.max, Math.round(side))) };
}
