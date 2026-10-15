import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Owner, 2026-10-15: "same-day delivery in Kampala & Wakiso" became "goes out today". Not every Wakiso area is in
 * rider range (those go by bus, multi-day), and delivery contract #10 forbids a point-in-time arrival promise. Every
 * customer-facing line now promises when the order goes OUT. The hero slide's stored copy is rewritten by 0186.
 */
const read = (p: string) => readFileSync(join(__dirname, '../..', p), 'utf8');
const CUSTOMER_FACING = [
  'apps/web/src/components/GpNav.astro',
  'apps/web/src/components/hero/HeroSlider.astro',
  'apps/web/src/lib/checkout.ts',
  'apps/web/src/lib/agentDocuments.ts',
  'apps/web/src/pages/wa.astro',
  'apps/web/src/pages/shop.astro',
  'apps/web/src/pages/delivery/kampala-wakiso.astro',
  'packages/shared/src/hero/library.ts',
];

describe('same-day is a dispatch promise', () => {
  it('no customer-facing line promises same-day delivery or delivery today', () => {
    for (const f of CUSTOMER_FACING) {
      // Comments may explain the history; strings may not make the promise.
      const code = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, f).not.toMatch(/['"`][^'"`]*(same[- ]day delivery|we deliver today|deliver today in|for delivery today|eligible for same-day)[^'"`]*['"`]/i);
    }
  });

  it('the hero migration rewrites only the retired phrases, and is registered', () => {
    const sql = read('apps/api/src/infrastructure/db/migrations/0186_hero_sameday_dispatch_copy.sql');
    expect(sql).toMatch(/replace\("headline", 'and we <em>deliver today<\/em>', 'and it <em>goes out today<\/em>'\)/);
    expect(sql).toMatch(/WHERE "slide_key" = 'sameday' AND "kicker" = 'Same-day delivery'/);
    const journal = JSON.parse(read('apps/api/src/infrastructure/db/migrations/meta/_journal.json'));
    expect(journal.entries.map((e: { tag: string }) => e.tag)).toContain('0186_hero_sameday_dispatch_copy');
  });
});
