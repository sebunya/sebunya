import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DISCOVERY_TAXONOMY } from '../../apps/web/src/lib/product-discovery';

const root = resolve(__dirname, '../..');
const layout = readFileSync(resolve(root, 'apps/web/src/layouts/BaseLayout.astro'), 'utf8');

describe('Slice 2 storefront residual contract', () => {
  it('covers the full brand taxonomy: 4 categories with their subcategories', () => {
    const names = DISCOVERY_TAXONOMY.map((c: any) => c.name).sort();
    expect(names).toEqual(['Car Accessories', 'Power Devices', 'Sound Devices', 'Storage Devices']);
    for (const category of DISCOVERY_TAXONOMY as any[]) {
      expect(category.subcategories.length, `${category.name} needs subcategories`).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps the newsletter truthful — a not-configured state, not a fake signup form', () => {
    expect(layout).toContain('Email updates opening soon');
    // No email input pretending to subscribe while nothing persists it.
    expect(layout).not.toMatch(/<input[^>]*type="email"[^>]*>/);
  });
});
