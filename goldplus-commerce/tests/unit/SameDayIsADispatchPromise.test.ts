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
  'packages/shared/src/nav/nba.ts',
];

// Owner 2026-11-05 (supersedes the dispatch-only decision of 2026-10-15): the promise is same-day dispatch AND
// delivery in Kampala and Wakiso, before the cut-off. Only these exact owner-approved strings may say it; every
// looser form ("we deliver today", "same-day delivery" anywhere else) is still refused.
const APPROVED_SAME_DAY = ["'Same-day delivery'", 'Same-day dispatch and delivery in Kampala and Wakiso'];

describe('same-day is a dispatch promise', () => {
  it('no customer-facing line promises same-day delivery or delivery today', () => {
    for (const f of CUSTOMER_FACING) {
      // Comments may explain the history; strings may not make the promise.
      let code = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      for (const ok of APPROVED_SAME_DAY) code = code.split(ok).join("''");
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

describe('the stored home page strip (0188)', () => {
  it('rewrites only the retired phrases, bumps the version, and is registered', () => {
    const sql = read('apps/api/src/infrastructure/db/migrations/0188_homepage_sameday_dispatch_copy.sql');
    expect(sql).toMatch(/replace\(replace\("config"::text, 'same-day delivery in Kampala', 'same-day dispatch in Kampala'\), '"Get it today"', '"Goes out today"'\)::jsonb/);
    expect(sql).toMatch(/"version" = "version" \+ 1/);
    const journal = JSON.parse(read('apps/api/src/infrastructure/db/migrations/meta/_journal.json'));
    expect(journal.entries.map((e: { tag: string }) => e.tag)).toContain('0188_homepage_sameday_dispatch_copy');
  });
});

describe('0220: same-day dispatch and delivery (owner 2026-11-05)', () => {
  it('rewrites only 0186 phrases on the sameday slide, keeps the headline, and is registered', () => {
    const sql = read('apps/api/src/infrastructure/db/migrations/0220_hero_sameday_delivery_copy.sql');
    expect(sql).toMatch(/SET "kicker" = 'Same-day delivery'.*WHERE "slide_key" = 'sameday' AND "kicker" = 'Same-day dispatch'/s);
    expect(sql).toContain("replace(\"subcopy\", 'Same-day dispatch in Kampala and Wakiso; when it arrives depends on the area.', 'Same-day dispatch and delivery in Kampala and Wakiso.')");
    expect(sql).not.toMatch(/SET "headline"/);
    const journal = JSON.parse(read('apps/api/src/infrastructure/db/migrations/meta/_journal.json'));
    expect(journal.entries.map((e: { tag: string }) => e.tag)).toContain('0220_hero_sameday_delivery_copy');
  });
});
