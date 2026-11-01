import { describe, expect, it } from 'vitest';
import {
  CROP_OUTPUT, CROP_ZOOM, clampCrop, cropScale, cropSide, cropSource, cropTransform, initialCrop, panCrop, zoomCrop, type PhotoCrop,
} from '../../apps/web/src/lib/photoCrop';

// The buy page's cropper: what the frame shows must be exactly what is uploaded, and the frame must never show a gap.
const FRAME = 288;
const near = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6);

/** The part of the photo the frame shows, from the CSS transform alone (as the browser draws it). */
function visible(c: PhotoCrop, frame = FRAME) {
  const t = cropTransform(c, frame);
  return { sx: -t.x / t.scale, sy: -t.y / t.scale, side: frame / t.scale };
}
const inside = (c: PhotoCrop) => {
  const v = visible(c);
  expect(v.sx).toBeGreaterThanOrEqual(-1e-6);
  expect(v.sy).toBeGreaterThanOrEqual(-1e-6);
  expect(v.sx + v.side).toBeLessThanOrEqual(c.width + 1e-6);
  expect(v.sy + v.side).toBeLessThanOrEqual(c.height + 1e-6);
};

describe('placing a photo in the square (the buy page cropper)', () => {
  it('a new photo is centred, its shorter side filling the square', () => {
    const c = initialCrop(4000, 3000);
    expect(c).toMatchObject({ cx: 2000, cy: 1500, zoom: 1 });
    expect(cropSide(c)).toBe(3000);
    expect(cropSource(c)).toEqual({ sx: 500, sy: 0, side: 3000, out: 1080 });
  });

  it('what the frame shows is exactly the square that is uploaded, at any frame size', () => {
    let c = zoomCrop(panCrop(initialCrop(3000, 2000), 37, -12, FRAME), 1.7, FRAME, 60, 200);
    for (const frame of [FRAME, 200, 512]) {
      const v = visible(c, frame);
      const s = cropSource(c);
      near(v.sx, s.sx); near(v.sy, s.sy); near(v.side, s.side);
    }
    // Turning the phone (a different frame size) changes nothing about the crop itself.
    c = clampCrop(c);
    expect(cropSource(c)).toEqual(cropSource(clampCrop(c)));
  });

  it('never a gap: however far it is dragged or zoomed, the square stays inside the photo', () => {
    let c = initialCrop(1200, 800);
    for (const [dx, dy] of [[5000, 0], [-9000, 0], [0, 7000], [0, -7000], [123, -456]]) { c = panCrop(c, dx, dy, FRAME); inside(c); }
    for (const z of [3, 0.2, 5, 1, 2.5, Number.NaN]) { c = zoomCrop(c, z, FRAME, 10, 270); inside(c); }
  });

  it('zooming keeps the part of the photo under the fingers (or the centre) where it is', () => {
    const c = initialCrop(4000, 4000);
    const fx = 100, fy = 220;
    const before = cropTransform(c, FRAME);
    const point = { x: (fx - before.x) / before.scale, y: (fy - before.y) / before.scale };
    const z = zoomCrop(c, 2, FRAME, fx, fy);
    const after = cropTransform(z, FRAME);
    near(point.x * after.scale + after.x, fx);
    near(point.y * after.scale + after.y, fy);
    expect(cropScale(z, FRAME) / cropScale(c, FRAME)).toBeCloseTo(2, 10);
  });

  it('zoom stays between 1 and 3; a pinch beyond either end stops there', () => {
    const c = initialCrop(2000, 2000);
    expect(zoomCrop(c, 9, FRAME).zoom).toBe(CROP_ZOOM.max);
    expect(zoomCrop(c, 0.1, FRAME).zoom).toBe(CROP_ZOOM.min);
  });

  it('the upload is at most 1080 px and never smaller than the smallest printable square', () => {
    expect(cropSource(zoomCrop(initialCrop(6000, 4000), 1, FRAME)).out).toBe(CROP_OUTPUT.max);
    expect(cropSource(zoomCrop(initialCrop(900, 900), 1, FRAME)).out).toBe(900); // its own size, not blown up
    expect(cropSource(zoomCrop(initialCrop(400, 400), 3, FRAME)).out).toBe(CROP_OUTPUT.min); // 133 px drawn up to 200
  });
});
