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
/** Letters-and-digits tokens: "GP - P07 PB" → ["gp","p07","pb"]; "gp-p07-pb-2.webp" → ["gp","p07","pb","2"]. */
/**
 * Letter runs and digit runs are separate tokens ("gp01" → gp, 1; "p07" → p, 7)
 * and digit runs compare by VALUE, so a photographer's "gp-001" is the price
 * list's "GP01" and "GP - P07 PB" is "gp-p07-pb".
 */
const tokens = (v: string) => (v.toLowerCase().match(/[a-z]+|\d+/g) ?? []).map((t) => (/^\d+$/.test(t) ? String(Number(t)) : t));
/** The code without its "gp" prefix: what must appear, in order, as whole tokens in the filename. */
const codeKey = (code: string) => { const t = tokens(code); const stripped = t[0] === 'gp' || t[0] === 'gd' ? t.slice(1) : t; return stripped.length ? stripped : t; };
/**
 * Does the code appear in the filename as whole tokens? Separators are free:
 * "GP04", "gp-04" and "gp 04" all name GP04, and "gp-p07-pb" names GP-P07-PB —
 * any run of filename tokens whose concatenation equals the code (with or
 * without the gp prefix) counts. A code can never match INSIDE another token.
 */
const containsRun = (hay: string[], run: string[]) => {
  if (run.length === 0) return false;
  // A short bare key ('1', '4') would match almost any filename; it is only
  // accepted with its gp prefix present.
  const bare = run.join('');
  const want = new Set(bare.length >= 3 ? [bare, `gp${bare}`] : [`gp${bare}`]);
  for (let i = 0; i < hay.length; i += 1) {
    let acc = '';
    for (let j = i; j < hay.length && acc.length < 40; j += 1) { acc += hay[j]; if (want.has(acc)) return true; }
  }
  return false;
};
/** A word in the filename that names a KIND of product; used only to refuse a match, never to make one. */
const KIND: Array<[RegExp, RegExp]> = [
  [/power ?bank|powerbank/, /power bank/i], [/charger|charging/, /charger/i], [/cable/, /cable/i], [/earbud|earphone|headset|headphone/, /earphone|bluetooth|headset|earbud/i],
  [/speaker/, /speaker|bluetooth/i], [/mouse/, /mouse/i], [/sound ?card/, /sound card/i], [/memory ?card|sd ?card/, /memory card/i], [/flash ?drive|usb ?drive/, /flash drive/i],
  [/battery/, /battery/i], [/card ?reader/, /card reader/i], [/car /, /car /i],
];
const MIME: Record<string, string> = { '.webp': 'image/webp', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.avif': 'image/avif' };
const rowsOf = (r: unknown): Record<string, unknown>[] => (Array.isArray(r) ? (r as never) : ((r as { rows?: never[] })?.rows ?? []));

async function main(): Promise<void> {
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the acting admin uuid.');
  const dir = String(process.env.IMAGES_DIR ?? '/import-images');
  const dryRun = process.env.DRY_RUN === '1';
  const r = Registry.getInstance();

  const products = rowsOf(await db.execute(sql`select id, name, slug, sku, model_number, category_name from products`)).map((p) => ({
    id: String(p.id), name: String(p.name), slug: String(p.slug), category: String(p.category_name ?? ''),
    keys: [...new Set([String(p.sku ?? ''), String(p.model_number ?? '')].map((c) => codeKey(c).join('-')).filter((k) => k.replace(/-/g, '').length >= 1))].map((k) => k.split('-')),
  }));
  const files = readdirSync(dir).filter((f) => MIME[extname(f).toLowerCase()] && statSync(join(dir, f)).isFile()).sort();

  const plan = new Map<string, string[]>(); const unmatched: string[] = []; const ambiguous: string[] = []; const conflicts: string[] = [];
  for (const file of files) {
    const stem = file.replace(extname(file), '');
    const hay = tokens(stem);
    // Longest code that appears as a whole-token run wins; equal lengths tie.
    let best: { id: string; len: number }[] = [];
    for (const p of products) for (const k of p.keys) {
      if (!containsRun(hay, k)) continue;
      const len = k.join('').length;
      if (!best.length || len > best[0].len) best = [{ id: p.id, len }];
      else if (len === best[0].len && !best.some((b) => b.id === p.id)) best.push({ id: p.id, len });
    }
    if (best.length === 0) { unmatched.push(file); continue; }
    if (best.length > 1) { ambiguous.push(`${file} → ${best.map((b) => products.find((p) => p.id === b.id)?.name).join(' | ')}`); continue; }
    const product = products.find((p) => p.id === best[0].id)!;
    // The filename says what KIND of thing it is; if the product is a different
    // kind, the code collided (the photo set and the price list use different
    // schemes) and the match is refused rather than guessed.
    const spaced = stem.toLowerCase().replace(/[^a-z0-9]+/g, ' ') + ' ';
    const kind = KIND.find(([inFile]) => inFile.test(spaced));
    if (kind && !kind[1].test(`${product.name} ${product.category}`)) { conflicts.push(`${file} ↛ ${product.name} (filename says a different kind of product)`); continue; }
    plan.set(product.id, [...(plan.get(product.id) ?? []), file]);
  }
  console.log(`files ${files.length}: matched ${[...plan.values()].flat().length} to ${plan.size} products, unmatched ${unmatched.length}, ambiguous ${ambiguous.length}, refused ${conflicts.length}`);
  for (const [id, fs] of plan) console.log(`  ${products.find((p) => p.id === id)?.name}: ${fs.join(', ')}`);
  for (const f of unmatched) console.log(`  UNMATCHED ${f}`);
  for (const a of ambiguous) console.log(`  AMBIGUOUS ${a}`);
  for (const c of conflicts) console.log(`  REFUSED ${c}`);
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
