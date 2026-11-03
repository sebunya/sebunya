import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizePimRow } from '../../../apps/api/src/domain/pim/PimImport';

const mapping = {
  sku: 'sku', modelNumber: 'model', name: 'name', slug: 'slug', categorySlug: 'category',
  shortDescription: 'short', longDescription: 'long', retailPriceUgx: 'price', floorPriceUgx: 'a', tierBPriceUgx: 'b',
} as const;

describe('PIM import: tiers parse like retail, an update keeps its slug', () => {
  it('"145 000" and "145,000" are 145000', () => {
    const r = normalizePimRow({ sku: 'GP-1', model: 'M', name: 'Name', slug: 'name-1', category: 'power', short: '', long: '', price: '185 000', a: '145 000', b: '160,000' }, mapping);
    expect(r.errors).toEqual([]);
    expect(r.value?.floorPriceUgx).toBe(145000);
    expect(r.value?.tierBPriceUgx).toBe(160000);
  });
  it('slug ownership only blocks a CREATE (preview and apply)', () => {
    const uc = readFileSync(join(__dirname, '../../../apps/api/src/application/use-cases/pim/PimImportOperationsUseCase.ts'), 'utf8');
    expect(uc).toMatch(/if \(slugOwner && !existing\)/);
    const repo = readFileSync(join(__dirname, '../../../apps/api/src/infrastructure/db/repositories/DrizzlePimImportRepository.ts'), 'utf8');
    expect(repo).not.toMatch(/slugOwner && slugOwner\.id !== existing\.id/);
  });
});
