import '../config/env';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { endDbConnection } from '../infrastructure/db/client';
import { Registry } from '../infrastructure/Registry';
import { requireMediaVolume } from './requireMediaVolume';
import type { GallerySlot } from '@goldplus/shared';

/**
 * Focus 4 — DEMO gallery frames (owner decision, 2026-09-22): until real
 * photography exists, fill slots 2–4 of every product that has a cover with
 * that product's OWN cover photo, marked "SAMPLE" in one corner, so the gallery
 * is visible across the site. Nothing is invented: it is the same real photo,
 * visibly labelled as a sample, with an honest alt text, assigned through the
 * audited gallery service, and removable with MODE=remove.
 *
 *   MODE=fill    (default)  add sample frames to empty slots 2–4
 *   MODE=remove             remove every frame this script created (by its alt marker)
 *   DRY_RUN=1    (default)  plan only
 *   ACTOR_USER_ID=<uuid>    required to apply
 *   ONLY=<sku>[,<sku>]      restrict to some products
 *
 * Why three distinct files: the gallery forbids the same asset in two slots of
 * one product (one photo, one slot). Each sample is its own asset (different
 * bytes: the corner mark says which frame it is), so a real photo later replaces
 * a slot without touching the others.
 */
export const SAMPLE_ALT_PREFIX = 'Sample view (same photo as the cover, placeholder until real photos)';
const LABELS: Record<2 | 3 | 4, string> = { 2: 'SAMPLE DETAIL', 3: 'SAMPLE CLOSE-UP', 4: 'SAMPLE FULL' };

/**
 * A tiny 5×7 glyph set drawn as rectangles: the badge text never depends on a font, so it
 * renders identically in the ops container (which has none), and each frame's bytes differ
 * by its words rather than by luck.
 */
const GLYPHS: Record<string, string[]> = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
};
function glyphText(text: string, px: number, x0: number, y0: number, fill: string): { svg: string; width: number } {
  let svg = ''; let x = x0;
  for (const ch of text) {
    const g = GLYPHS[ch] ?? GLYPHS[' '];
    g.forEach((row, r) => { for (let c = 0; c < 5; c++) if (row[c] === '1') svg += `<rect x="${x + c * px}" y="${y0 + r * px}" width="${px}" height="${px}" fill="${fill}"/>`; });
    x += 6 * px;
  }
  return { svg, width: x - x0 - px };
}

/** Where the product actually is: the photo minus its plain background. Falls back to the full frame. */
async function contentBox(sharp: any, source: Buffer, W: number, H: number): Promise<{ left: number; top: number; width: number; height: number }> {
  try {
    const { info } = await sharp(source).trim({ threshold: 24 }).toBuffer({ resolveWithObject: true });
    const left = Math.max(0, -(info.trimOffsetLeft ?? 0)); const top = Math.max(0, -(info.trimOffsetTop ?? 0));
    if (info.width >= W * 0.15 && info.height >= H * 0.15) return { left, top, width: info.width, height: info.height };
  } catch { /* fall through to the full frame */ }
  return { left: 0, top: 0, width: W, height: H };
}

/**
 * Three visibly different views derived from the SAME real photo, so the demo shows what a
 * gallery is for: slot 2 = the content's centre at 1.6×, slot 3 = the content's right half at
 * 2× (the loose product on GoldPlus packaging shots), slot 4 = the full photo. Crops of a real
 * photo state nothing new about the product; the badge says which view.
 */
async function sampleFrame(sharp: any, source: Buffer, slot: 2 | 3 | 4): Promise<Buffer> {
  const meta0 = await sharp(source).metadata();
  const W = meta0.width ?? 1000; const H = meta0.height ?? 1000;
  const box = await contentBox(sharp, source, W, H);
  const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(v)));
  let base = sharp(source);
  if (slot === 2) {
    const cw = clamp(box.width * 0.62, 64, W); const ch = clamp(box.height * 0.62, 64, H);
    base = sharp(source).extract({ left: clamp(box.left + (box.width - cw) / 2, 0, W - cw), top: clamp(box.top + (box.height - ch) / 2, 0, H - ch), width: cw, height: ch }).resize(W, H, { fit: 'cover' });
  }
  if (slot === 3) {
    const cw = clamp(box.width * 0.5, 64, W); const ch = clamp(box.height * 0.55, 64, H);
    base = sharp(source).extract({ left: clamp(box.left + box.width - cw, 0, W - cw), top: clamp(box.top + (box.height - ch) / 2, 0, H - ch), width: cw, height: ch }).resize(W, H, { fit: 'cover' });
  }
  source = await base.png().toBuffer();
  const meta = await sharp(source).metadata();
  const w = meta.width ?? 1000; const h = meta.height ?? 1000;
  const px = Math.max(2, Math.round(w * 0.0065));
  const measured = glyphText(LABELS[slot], px, 0, 0, '#93D500');
  const badgeW = measured.width + px * 8; const badgeH = px * 7 + px * 6;
  const badge = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${badgeW}" height="${badgeH}"><rect width="100%" height="100%" rx="${Math.round(badgeH / 2)}" fill="#0A0A0A" fill-opacity="0.78"/>${glyphText(LABELS[slot], px, px * 4, px * 3, '#93D500').svg}</svg>`);
  return sharp(source).composite([{ input: badge, top: Math.round(h * 0.03), left: Math.round(w - badgeW - w * 0.03) }]).webp({ quality: 82 }).toBuffer();
}

async function main() {
  const mode = process.env.MODE === 'remove' ? 'remove' : 'fill';
  const dryRun = process.env.DRY_RUN !== '0';
  const actorId = String(process.env.ACTOR_USER_ID ?? '');
  if (!dryRun && !/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the acting admin uuid to apply.');
  const only = new Set(String(process.env.ONLY ?? '').split(',').map((s) => s.trim()).filter(Boolean));
  const mediaRoot = requireMediaVolume();
  const r = Registry.getInstance();
  const repo = r.productMediaRepo;
  const gallery = r.productMediaUseCases;
  const library = r.mediaLibraryUseCase;
  const sharp = (await import('sharp')).default;

  const all = await repo.listCompleteness();
  const targets = all.filter((p) => p.active && p.hasCover && (only.size === 0 || only.has(p.sku)));
  const totals = { products: 0, framesAdded: 0, framesRemoved: 0, skipped: 0, failed: 0 };
  for (const p of targets) {
    const snap = await repo.getSnapshot(p.productId);
    if (!snap) continue;
    const current = gallery.currentMap(snap);
    const cover = snap.rows.find((row) => row.slot === 1);
    if (!cover?.assetId) continue;

    if (mode === 'remove') {
      const sampleSlots = snap.rows.filter((row) => row.slot && row.slot !== 1 && (row.altText ?? '').startsWith(SAMPLE_ALT_PREFIX)).map((row) => row.slot as GallerySlot);
      if (sampleSlots.length === 0) { totals.skipped += 1; continue; }
      totals.products += 1;
      if (dryRun) { totals.framesRemoved += sampleSlots.length; console.log(`${p.sku}: would remove sample slots ${sampleSlots.join(',')}`); continue; }
      const map = current.filter((a) => !sampleSlots.includes(a.slot));
      const res = await gallery.replaceMap({ productId: p.productId, expectedRevision: snap.mediaRevision, map, actorId, action: 'DEMO_FRAMES_REMOVE' });
      if (res.ok) totals.framesRemoved += sampleSlots.length; else { totals.failed += 1; console.log(`${p.sku}: FAILED ${res.code} ${res.message}`); }
      continue;
    }

    const empty = ([2, 3, 4] as const).filter((s) => !current.some((a) => a.slot === s));
    if (empty.length === 0) { totals.skipped += 1; continue; }
    const sourcePath = join(mediaRoot, cover.url.replace(/^\//, ''));
    if (!existsSync(sourcePath)) { totals.failed += 1; console.log(`${p.sku}: cover file missing on the volume (${cover.url})`); continue; }
    totals.products += 1;
    if (dryRun) { totals.framesAdded += empty.length; console.log(`${p.sku}: would add sample frames to slots ${empty.join(',')} from ${cover.url}`); continue; }
    const source = readFileSync(sourcePath);
    const additions: Array<{ slot: GallerySlot; assetId: string; altText: string }> = [];
    for (const slot of empty) {
      const bytes = await sampleFrame(sharp, source, slot);
      const [outcome] = await library.upload({ files: [{ filename: `${p.sku}__0${slot}-sample.webp`, mime: 'image/webp', buffer: bytes }], altText: `${SAMPLE_ALT_PREFIX} — ${p.sku} frame ${slot}`, caption: null, actorId });
      if (outcome.kind !== 'STORED') { console.log(`${p.sku}: slot ${slot} rejected by the library (${outcome.reason})`); continue; }
      additions.push({ slot, assetId: outcome.asset.id, altText: `${SAMPLE_ALT_PREFIX} — ${p.sku} frame ${slot}` });
    }
    if (additions.length === 0) { totals.failed += 1; continue; }
    const res = await gallery.replaceMap({ productId: p.productId, expectedRevision: snap.mediaRevision, map: [...current, ...additions], actorId, action: 'DEMO_FRAMES_FILL' });
    if (res.ok) totals.framesAdded += additions.length; else { totals.failed += 1; console.log(`${p.sku}: FAILED ${res.code} ${res.message}`); }
  }
  // Sample assets that no gallery references (a failed run, or frames since removed) are pruned:
  // safeDelete refuses anything still in use, so a live frame can never be deleted here.
  if (!dryRun) {
    const unassigned = (await repo.listUnassignedAssets(500, 0)).filter((a) => a.filename.endsWith('-sample.webp'));
    let pruned = 0;
    for (const a of unassigned) { const res = await library.safeDelete(a.id); if (res.kind === 'DELETED') pruned += 1; }
    if (unassigned.length) console.log(`pruned ${pruned} of ${unassigned.length} unreferenced sample assets`);
  }
  console.log(`${dryRun ? 'DRY RUN — nothing written.' : 'APPLIED.'} mode=${mode} products ${totals.products}, frames ${mode === 'remove' ? 'removed' : 'added'} ${mode === 'remove' ? totals.framesRemoved : totals.framesAdded}, skipped ${totals.skipped}, failed ${totals.failed}. Products without any cover are untouched (${all.filter((p) => p.active && !p.hasCover).length}).`);
}

/** Exported so a local check can render frames from a file without a database. */
export { sampleFrame };

if (process.env.DEMO_FRAMES_NO_MAIN !== '1') {
  main()
    .then(async () => { await endDbConnection(); process.exit(0); })
    .catch(async (error) => { console.error('FAILED:', error instanceof Error ? error.message : error); await endDbConnection(); process.exit(1); });
}
