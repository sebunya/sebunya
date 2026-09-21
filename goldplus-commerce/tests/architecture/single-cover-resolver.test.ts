import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Focus 4 — ONE cover authority.
 *
 * Every reader that picks "the product image" must go through
 * `resolveGallery` (rows) or `galleryOrderSql` (SQL). A hand-rolled
 * `is_primary DESC, display_order ASC` anywhere else is a second authority and
 * fails the build. Likewise, nothing but the mutation repository may write
 * product_images.
 */

const ROOT = join(__dirname, '..', '..');
const API_SRC = join(ROOT, 'apps', 'api', 'src');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

const files = walk(API_SRC);
const read = (p: string) => readFileSync(p, 'utf8');
const rel = (p: string) => p.slice(ROOT.length + 1);

const RESOLVER_FILES = new Set([
  'apps/api/src/infrastructure/db/mediaDisplayUrl.ts',
  // The backfill planner reads the legacy order ON PURPOSE: it is the one place
  // that turns "what the old flags said" into slot 1, and it never serves a reader.
  'apps/api/src/domain/media/ProductMediaBackfill.ts',
]);
const WRITER_FILES = new Set([
  'apps/api/src/infrastructure/db/repositories/DrizzleProductMediaRepository.ts',
  // Legacy row deletion only (unslotted rows), refuses everything else:
  'apps/api/src/infrastructure/db/repositories/DrizzleProductImageRepository.ts',
  // Seed data for local development, not a runtime path:
  'apps/api/src/scripts/seed.ts',
]);

describe('single cover resolver (Focus 4)', () => {
  it('no reader orders product images by is_primary/display_order outside the resolver', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const r = rel(f);
      if (RESOLVER_FILES.has(r)) continue;
      const src = read(f);
      if (/is_primary\s+desc/i.test(src) && /display_order/i.test(src)) offenders.push(`${r} (SQL)`);
      if (/isPrimary\s*(===|!==|\?|\)\s*-|DESC)/.test(src) && /displayOrder/.test(src) && /sort\(/.test(src)) offenders.push(`${r} (JS sort)`);
      if (/desc\(productImages\.isPrimary\)/.test(src) && !/productImages\.slot/.test(src)) offenders.push(`${r} (drizzle orderBy)`);
    }
    expect(offenders).toEqual([]);
  });

  it('product_images is written only by the gallery mutation repository', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const r = rel(f);
      if (WRITER_FILES.has(r)) continue;
      const src = read(f);
      if (/\.(insert|update|delete)\(productImages\)/.test(src)) offenders.push(r);
      if (/(insert\s+into|update|delete\s+from)\s+product_images\b/i.test(src)) offenders.push(`${r} (raw SQL)`);
    }
    expect(offenders).toEqual([]);
  });

  it('the shared resolver and the SQL order agree on precedence: slot, then is_primary, then display_order', () => {
    const shared = readFileSync(join(ROOT, 'packages', 'shared', 'src', 'media', 'resolveGallery.ts'), 'utf8');
    const sqlSide = readFileSync(join(API_SRC, 'infrastructure', 'db', 'mediaDisplayUrl.ts'), 'utf8');
    expect(shared).toMatch(/isGallerySlot\(r\.slot\)/);
    expect(shared).toMatch(/a\.isPrimary === b\.isPrimary \? a\.displayOrder - b\.displayOrder/);
    expect(sqlSide).toMatch(/slot ASC NULLS LAST, \$\{i\}\.is_primary DESC, \$\{i\}\.display_order ASC/);
  });
});
