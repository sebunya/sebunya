import '../config/env';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { sql } from 'drizzle-orm';
import { Registry } from '../infrastructure/Registry';
import { db, endDbConnection } from '../infrastructure/db/client';

/**
 * Attach a folder of product photographs by PRODUCT CODE, through the media
 * pipeline, so the owner never has to fill 174 image forms.
 *
 * Matching: every letter and digit in the filename is compared with every
 * letter and digit of each product's SKU and model number. The LONGEST code
 * contained in the filename wins, so "gp-4lt.webp" goes to GP-4LT and not to
 * GP-4L. A filename matching nothing, or two codes of equal length, is
 * reported and skipped — never guessed. Files for one product are ordered by
 * name: the first becomes the primary image, the rest the gallery. Re-running
 * is safe: the media library dedupes identical bytes, and a product that
 * already has that image is skipped.
 *
 * Name files with the code, anything else around it is ignored:
 *   GP-C04-TYPE-C.webp        primary
 *   GP-C04-TYPE-C-2.jpg       second image
 *   goldplus battery gp-ip-x front.png   → GP - IP X
 *
 *   ACTOR_USER_ID=<uuid> IMAGES_DIR=/import-images [DRY_RUN=1] npx tsx src/scripts/attach-images-by-code.ts
 */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const MIME: Record<string, string> = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.avif': 'image/avif' };
const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? (r as never) : ((r as { rows?: never[] })?.rows ?? []));

async function main(): Promise<void> {
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the acting admin uuid.');
  const dir = String(process.env.IMAGES_DIR ?? '/import-images');
  const dryRun = process.env.DRY_RUN === '1';
  const r = Registry.getInstance();

  const products = rowsOf(await db.execute(sql`select id, name, slug, sku, model_number from products`)).map((p) => ({
    id: String(p.id), name: String(p.name), slug: String(p.slug),
    codes: [String(p.sku ?? ''), String(p.model_number ?? '')].map(norm).filter((c) => c.length >= 3),
  }));
  const files = readdirSync(dir).filter((f) => MIME[extname(f).toLowerCase()] && statSync(join(dir, f)).isFile()).sort();

  const plan = new Map<string, string[]>(); const unmatched: string[] = []; const ambiguous: string[] = [];
  for (const file of files) {
    const key = norm(file.replace(extname(file), ''));
    let best: { id: string; len: number }[] = [];
    for (const p of products) for (const c of p.codes) {
      if (!key.includes(c)) continue;
      if (!best.length || c.length > best[0].len) best = [{ id: p.id, len: c.length }];
      else if (c.length === best[0].len && !best.some((b) => b.id === p.id)) best.push({ id: p.id, len: c.length });
    }
    if (best.length === 0) unmatched.push(file);
    else if (best.length > 1) ambiguous.push(`${file} → ${best.map((b) => products.find((p) => p.id === b.id)?.name).join(' | ')}`);
    else plan.set(best[0].id, [...(plan.get(best[0].id) ?? []), file]);
  }
  console.log(`files ${files.length}: matched ${[...plan.values()].flat().length} to ${plan.size} products, unmatched ${unmatched.length}, ambiguous ${ambiguous.length}`);
  for (const [id, fs] of plan) console.log(`  ${products.find((p) => p.id === id)?.name}: ${fs.join(', ')}`);
  for (const f of unmatched) console.log(`  UNMATCHED ${f}`);
  for (const a of ambiguous) console.log(`  AMBIGUOUS ${a}`);
  if (dryRun) { console.log('DRY RUN — nothing attached.'); return; }

  let attached = 0, skipped = 0;
  for (const [productId, fs] of plan) {
    const product = products.find((p) => p.id === productId)!;
    const existing = await r.productImageRepo.findByProductId(productId);
    for (const [i, file] of fs.entries()) {
      const [outcome] = await r.mediaLibraryUseCase.upload({ files: [{ filename: file, mime: MIME[extname(file).toLowerCase()], buffer: readFileSync(join(dir, file)) }], altText: product.name, caption: null, actorId });
      if (outcome.kind !== 'STORED') { console.log(`  ${product.name}: ${file} ${outcome.kind}`); continue; }
      const url = outcome.asset.url;
      if (existing.some((img) => img.url === url)) { skipped += 1; continue; }
      if (i === 0 && existing.length === 0) await r.mediaLibraryUseCase.assignToProduct(outcome.asset.id, productId);
      else await r.productImageRepo.add({ productId, url, altText: product.name, makePrimary: false });
      attached += 1;
    }
  }
  console.log(`attached ${attached}, already present ${skipped}`);
}
main().then(() => endDbConnection()).catch(async (e) => { console.error(e); await endDbConnection(); process.exit(1); });
