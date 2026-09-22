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
const LABELS: Record<2 | 3 | 4, string> = { 2: 'SAMPLE 2', 3: 'SAMPLE 3', 4: 'SAMPLE 4' };

async function sampleFrame(sharp: any, source: Buffer, slot: 2 | 3 | 4): Promise<Buffer> {
  const meta = await sharp(source).metadata();
  const w = meta.width ?? 1000; const h = meta.height ?? 1000;
  const badgeW = Math.round(w * 0.22); const badgeH = Math.round(h * 0.07); const font = Math.round(badgeH * 0.55);
  const badge = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${badgeW}" height="${badgeH}"><rect width="100%" height="100%" rx="${Math.round(badgeH / 2)}" fill="#0A0A0A" fill-opacity="0.72"/><text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${font}" font-weight="700" letter-spacing="1" fill="#93D500">${LABELS[slot]}</text></svg>`);
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
  console.log(`${dryRun ? 'DRY RUN — nothing written.' : 'APPLIED.'} mode=${mode} products ${totals.products}, frames ${mode === 'remove' ? 'removed' : 'added'} ${mode === 'remove' ? totals.framesRemoved : totals.framesAdded}, skipped ${totals.skipped}, failed ${totals.failed}. Products without any cover are untouched (${all.filter((p) => p.active && !p.hasCover).length}).`);
}

main()
  .then(async () => { await endDbConnection(); process.exit(0); })
  .catch(async (error) => { console.error('FAILED:', error instanceof Error ? error.message : error); await endDbConnection(); process.exit(1); });
