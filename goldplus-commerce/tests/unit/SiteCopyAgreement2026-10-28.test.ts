import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * 2026-10-28: three pairs of customer pages contradicted each other, and three hub parents were 404s.
 * These pins keep each pair saying the same thing and keep the parents answering.
 */
describe('site copy agrees with itself', () => {
  it('returns: the shop page and guide 102 point to the same two routes (shop with receipt, or online)', () => {
    for (const p of ['apps/web/src/pages/locations/zainab-aziza.astro', 'docs/content/guides/102-visiting-the-goldplus-shop.md']) {
      const s = read(p);
      expect(s).not.toMatch(/handled directly at the shop/);
      expect(s).toMatch(/Bring it back to the shop with your receipt/);
      expect(s).toMatch(/start a return online/i);
    }
    expect(read('apps/web/src/pages/returns.astro')).toMatch(/Bought at the shop\? Bring the item and your receipt/);
  });

  it('verification codes: one earn per code, matching the single-use rule on /verification', () => {
    expect(read('apps/web/src/pages/verification/index.astro')).toMatch(/Codes can only be verified once/);
    for (const p of ['apps/web/src/pages/loyalty.astro', 'docs/content/guides/101-goldplus-loyalty-points-explained.md']) {
      const s = read(p);
      expect(s).not.toMatch(/per scan/);
      expect(s).toMatch(/Each code earns once/);
    }
  });

  it('hub parents redirect to their one child instead of a 404', () => {
    const pairs: Array<[string, string]> = [
      ['delivery', '/delivery/kampala-wakiso'],
      ['locations', '/locations/zainab-aziza'],
      ['dealers', '/dealers/apply'],
    ];
    for (const [dir, target] of pairs) {
      expect(read(`apps/web/src/pages/${dir}/index.astro`)).toMatch(new RegExp(`Astro\\.redirect\\('${target}', 301\\)`));
    }
  });
});
