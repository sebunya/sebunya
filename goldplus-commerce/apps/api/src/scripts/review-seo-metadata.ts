import '../config/env';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Registry } from '../infrastructure/Registry';
import { endDbConnection } from '../infrastructure/db/client';

/**
 * READ-ONLY review of the product metadata queue from the website copy/SEO
 * handoff (V2, 2026-10-12): for every record, print the live name and short
 * description beside the handoff's candidate and its state, so the owner can
 * decide field by field. The handoff is explicit that these are review inputs,
 * not an import: this script never writes. Identity holds (C09/C10, GP02BT,
 * H02, 58BX/51BX, GP01, GP-W2/W5, C12/C13) are listed first.
 *
 *   npx tsx src/scripts/review-seo-metadata.ts            # all 183
 *   ONLY=changes npx tsx src/scripts/review-seo-metadata.ts  # the 16 non-retain records
 */
interface Rec { sku: string; slug: string | null; state: string; titleCandidate: string | null; descriptionCandidate: string | null; review: string | null }
interface DataFile { records: Rec[] }

async function main(): Promise<void> {
  const dataFile = String(process.env.DATA_FILE ?? '').trim() || join(__dirname, 'data', 'seo-metadata-review-2026-10-12.json');
  const { records } = JSON.parse(readFileSync(dataFile, 'utf8')) as DataFile;
  const onlyChanges = process.env.ONLY === 'changes';
  const r = Registry.getInstance();
  const order = (s: string) => (s.startsWith('IDENTITY_HOLD') ? 0 : s.startsWith('PROPOSED') ? 1 : 2);
  const sorted = [...records].sort((a, b) => order(a.state) - order(b.state) || a.sku.localeCompare(b.sku));
  let missing = 0, retained = 0, holds = 0, proposed = 0;
  for (const rec of sorted) {
    if (onlyChanges && rec.state === 'RETAIN_CURRENT_REVIEW_ONLY') { retained += 1; continue; }
    const live = rec.slug ? await r.productRepo.findPublicViewBySlug(rec.slug) : null;
    if (!live) { missing += 1; console.log(`\n${rec.sku}  ${rec.state}\n  LIVE: not found by slug ${rec.slug ?? '(none)'}`); continue; }
    if (rec.state.startsWith('IDENTITY_HOLD')) holds += 1; else if (rec.state.startsWith('PROPOSED')) proposed += 1; else retained += 1;
    const e = live.entity;
    const sameTitle = (rec.titleCandidate ?? '').trim() === e.name.trim();
    console.log(`\n${rec.sku}  ${rec.state}`);
    console.log(`  name        live: ${e.name}`);
    if (!sameTitle) console.log(`              cand: ${rec.titleCandidate ?? '(none)'}`);
    console.log(`  short desc  live: ${e.shortDescription.slice(0, 140)}`);
    if (rec.descriptionCandidate) console.log(`              cand: ${rec.descriptionCandidate.slice(0, 140)}  (price in a candidate is NOT data; live price is UGX ${live.retailPriceUgx ?? '?'})`);
    if (rec.review) console.log(`  review      ${rec.review}`);
  }
  console.log(`\nidentity holds ${holds} · proposed copy ${proposed} · retain/review-only ${retained} · not found ${missing}. Nothing was written.`);
}

main().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => endDbConnection());
