import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DISCOVERY_TAXONOMY } from '../../apps/web/src/lib/product-discovery';

const root = resolve(__dirname, '../..');
const layout = readFileSync(resolve(root, 'apps/web/src/layouts/BaseLayout.astro'), 'utf8');

describe('Slice 2 storefront residual contract', () => {
  it('covers the full brand taxonomy: 5 categories with their subcategories', () => {
    // 2026-08-08: PC Accessories joined the taxonomy — the previously orphaned
    // PC category now has a home (Mice, Sound Cards) instead of falling through.
    const names = DISCOVERY_TAXONOMY.map((c: any) => c.name).sort();
    expect(names).toEqual(['Car Accessories', 'PC Accessories', 'Power Devices', 'Sound Devices', 'Storage Devices']);
    for (const category of DISCOVERY_TAXONOMY as any[]) {
      expect(category.subcategories.length, `${category.name} needs subcategories`).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps the newsletter truthful — no fake signup form', () => {
    // The footer rebuild removed the newsletter block entirely rather than ship a
    // form that pretends to subscribe while nothing persists it. The guarantee is
    // unchanged: no email input in the footer promising a subscription we can't keep.
    expect(layout).not.toMatch(/<input[^>]*type="email"[^>]*>/);
    expect(layout).not.toMatch(/subscribe to our newsletter/i);
  });
});
