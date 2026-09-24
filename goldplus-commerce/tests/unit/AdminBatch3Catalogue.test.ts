import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import { changedPricingFields, parsePriceTiers, tiersWithStoredDefaults } from '../../apps/api/src/domain/products/PriceTiers';
import { checkPublicationChange } from '../../apps/api/src/domain/products/ProductPublication';
import { normalizePimRow, pimRowChangesPricing, type PimMapping } from '../../apps/api/src/domain/pim/PimImport';
import { GetAdminProductViewUseCase } from '../../apps/api/src/application/use-cases/products/GetAdminProductViewUseCase';
import { summariseProductUpload } from '../../apps/api/src/application/use-cases/products/UploadProductImagesUseCase';
import { PimImportOperationsUseCase } from '../../apps/api/src/application/use-cases/pim/PimImportOperationsUseCase';
import { BatteryImportUseCases } from '../../apps/api/src/application/use-cases/batteries/BatteryImportUseCases';
import { ProductEntity } from '../../apps/api/src/domain/products/ProductEntity';

/**
 * Admin sweep batch 3 (2026-09-24) — catalogue write path.
 */

const read = (p: string) => readFileSync(p, 'utf8');
const ROUTE = read('apps/api/src/interfaces/http/routes/admin/products.ts');

describe('an omitted price tier is never wiped', () => {
  const stored = { floorPriceUgx: 140000, tierBPriceUgx: 150000, tierCPriceUgx: null };
  it('keeps stored tiers for keys the request leaves out', () => {
    const r = parsePriceTiers(tiersWithStoredDefaults({}, stored), 185000);
    expect(r).toEqual({ ok: true, value: stored });
  });
  it('still clears a tier sent explicitly empty', () => {
    const r = parsePriceTiers(tiersWithStoredDefaults({ floorPriceUgx: '' }, stored), 185000);
    expect(r.ok && r.value.floorPriceUgx).toBe(null);
    expect(r.ok && r.value.tierBPriceUgx).toBe(150000);
  });
});

describe('repricing needs a pricing permission', () => {
  const tiers = { floorPriceUgx: 145000, tierBPriceUgx: null, tierCPriceUgx: null };
  it('an unchanged resubmission is not a price change', () => {
    expect(changedPricingFields({ retailPriceUgx: 185000, tiers }, { retailPriceUgx: 185000, tiers: { ...tiers } })).toEqual([]);
  });
  it('names the floor and the retail price when they move', () => {
    expect(changedPricingFields({ retailPriceUgx: 185000, tiers }, { retailPriceUgx: 170000, tiers: { ...tiers, floorPriceUgx: 1 } }))
      .toEqual(['retail price (Price D)', 'floor (Price A)']);
  });
  it('the PUT route refuses a price change without pricing.manage / pricing.approve', () => {
    expect(ROUTE).toMatch(/PRICING_PERMISSION_REQUIRED/);
    expect(ROUTE).toMatch(/changedPricingFields\(/);
    expect(ROUTE).toMatch(/PERMISSIONS\.PRICING_MANAGE/);
  });
  it('PIM apply flags UPDATE rows that reprice an existing product', () => {
    const data = { retailPriceUgx: 185000, floorPriceUgx: null, tierBPriceUgx: null, tierCPriceUgx: null };
    expect(pimRowChangesPricing({ action: 'CREATE', normalizedData: data, beforeSnapshot: null })).toBe(false);
    expect(pimRowChangesPricing({ action: 'UPDATE', normalizedData: data, beforeSnapshot: { retailPriceUgx: 185000, floorPriceUgx: 140000 } })).toBe(false);
    expect(pimRowChangesPricing({ action: 'UPDATE', normalizedData: { ...data, floorPriceUgx: 1 }, beforeSnapshot: { retailPriceUgx: 185000, floorPriceUgx: 140000 } })).toBe(true);
    expect(pimRowChangesPricing({ action: 'UPDATE', normalizedData: { ...data, retailPriceUgx: 99000 }, beforeSnapshot: { retailPriceUgx: 185000 } })).toBe(true);
  });
  it('PIM apply refuses before applying anything when the actor cannot price', async () => {
    const repo = {
      rows: vi.fn(async () => [{ status: 'VALID', action: 'UPDATE', normalizedData: { retailPriceUgx: 1, floorPriceUgx: null, tierBPriceUgx: null, tierCPriceUgx: null }, beforeSnapshot: { retailPriceUgx: 185000 } }]),
      beginApply: vi.fn(),
      applyRow: vi.fn(),
      finishApply: vi.fn(),
    };
    const uc = new PimImportOperationsUseCase(repo as any);
    await expect(uc.apply({ id: 's', expectedVersion: 1, actorId: 'm', actorPermissions: ['pim.apply'] })).rejects.toMatchObject({ code: 'PRICING_PERMISSION_REQUIRED' });
    expect(repo.beginApply).not.toHaveBeenCalled();
  });
  it('a battery PRICE_UPDATE import needs a pricing permission too, refused before apply starts', async () => {
    const make = (importType: string) => {
      const repo = { find: vi.fn(async () => ({ id: 's', importType })), beginApply: vi.fn(async () => null) };
      const uc = new BatteryImportUseCases(repo as any, ...(Array(9).fill({}) as [any, any, any, any, any, any, any, any, any]));
      return { repo, uc };
    };
    const price = make('PRICE_UPDATE');
    await expect(price.uc.apply({ id: 's', expectedVersion: 1, actorId: 'm', canRecordCost: false, canPrice: false })).rejects.toMatchObject({ code: 'PRICING_PERMISSION_REQUIRED', status: 403 });
    expect(price.repo.beginApply).not.toHaveBeenCalled();
    // Other import types, and a caller who can price, go on to the normal apply path.
    const count = make('STOCK_COUNT');
    await expect(count.uc.apply({ id: 's', expectedVersion: 1, actorId: 'm', canRecordCost: false, canPrice: false })).rejects.toMatchObject({ code: 'STALE_VERSION' });
    expect(count.repo.beginApply).toHaveBeenCalled();
    const priced = make('PRICE_UPDATE');
    await expect(priced.uc.apply({ id: 's', expectedVersion: 1, actorId: 'm', canRecordCost: false, canPrice: true })).rejects.toMatchObject({ code: 'STALE_VERSION' });
    expect(read('apps/api/src/interfaces/http/routes/admin/battery-imports.ts')).toMatch(/canPrice: has\(c, PERMISSIONS\.PRICING_MANAGE\) \|\| has\(c, PERMISSIONS\.PRICING_APPROVE\)/);
  });
});

describe('a product without a price cannot go live', () => {
  const base = { before: null, canPublish: true, stockQuantity: 5, stockStatus: 'in_stock' as const };
  it('refuses publishing at price 0', () => {
    expect(checkPublicationChange({ ...base, after: { approvalStatus: 'approved', active: true }, priceUgx: 0 }))
      .toMatchObject({ ok: false, code: 'NO_PRICE', message: 'Set a selling price before publishing.' });
  });
  it('refuses clearing the price of a product that stays live', () => {
    expect(checkPublicationChange({ ...base, before: { approvalStatus: 'approved', active: true }, after: { approvalStatus: 'approved', active: true }, priceUgx: 0 }))
      .toMatchObject({ ok: false, code: 'NO_PRICE' });
  });
  it('a priced product and a priceless draft are fine', () => {
    expect(checkPublicationChange({ ...base, after: { approvalStatus: 'approved', active: true }, priceUgx: 185000 }).ok).toBe(true);
    expect(checkPublicationChange({ ...base, after: { approvalStatus: 'draft', active: false }, priceUgx: 0 }).ok).toBe(true);
  });
  it('bulk approval joins on a positive price, and the PDP hides Add to cart without one', () => {
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleProductRepository.ts')).toMatch(/approvalStatus === 'approved' \? and\(byId, gt\(products\.priceUgx, 0\)\)/);
    expect(read('apps/web/src/pages/products/[slug].astro')).toMatch(/const canBuy = product\?\.availability\.kind === 'in_stock' && pdpHasPrice;/);
  });
});

describe('PIM retail price accepts grouped thousands, like the tiers', () => {
  const mapping = { sku: 'sku', modelNumber: 'model', name: 'name', slug: 'slug', categorySlug: 'cat', shortDescription: 'sd', longDescription: 'ld', retailPriceUgx: 'retail', floorPriceUgx: 'floor' } as unknown as PimMapping;
  it("parses '185,000' as 185000", () => {
    const r = normalizePimRow({ sku: 'GP-1', model: 'M1', name: 'Power bank', slug: 'power-bank', cat: 'power', sd: '', ld: '', retail: '185,000', floor: '140,000' }, mapping);
    expect(r.value?.retailPriceUgx).toBe(185000);
    expect(r.errors).not.toContain('Retail price must be a positive integer in UGX.');
  });
});

describe('admin product pages read an ungated admin view', () => {
  const entity = (approvalStatus: 'draft' | 'approved', active: boolean) =>
    new ProductEntity('11111111-1111-4111-8111-111111111111', 'GP-1', 'M1', 'Draft', 'draft-1', 'Power', undefined, 's', 'l', 0, undefined, 'out_of_stock', undefined, [], '1 Year', true, active, approvalStatus, false, false, false, 0, {});
  it('returns drafts and says they are not live', async () => {
    const repo = { findAdminViewById: vi.fn(async () => ({ entity: entity('draft', false), retailPriceUgx: null, categoryName: 'Power', images: [], attributeValues: [] })) };
    const r = await new GetAdminProductViewUseCase(repo as any).execute('11111111-1111-4111-8111-111111111111');
    expect(r.ok && r.dto.liveOnStorefront).toBe(false);
    expect(r.ok && r.dto.approvalStatus).toBe('draft');
  });
  it('detail and asset editor use /admin/products/:id/view, not the public route', () => {
    for (const p of ['apps/web/src/pages/admin/products/[id].astro', 'apps/web/src/pages/admin/products/[id]/edit.astro']) {
      const src = read(p);
      expect(src, p).toMatch(/\/admin\/products\/\$\{encodeURIComponent\([^)]*\)\}\/view/);
      expect(src, p).not.toMatch(/fetch\(`\$\{apiBase\}\/products\//);
      expect(src, p).not.toMatch(/removed or archived|Asset Unavailable/);
    }
    // The public route keeps its gate.
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleProductRepository.ts')).toMatch(/row\.approvalStatus !== 'approved' \|\| !row\.active\) return null;/);
  });
});

describe('legacy image URL, slug and clears', () => {
  const edit = read('apps/web/src/pages/admin/products/[id]/edit-properties.astro');
  it('the edit form has no free-text image URL and no name→slug rewriter', () => {
    expect(edit).not.toMatch(/name="imageUrl"|Authoritative Image URL/);
    expect(edit).not.toMatch(/nameInput\.addEventListener/);
    expect(read('apps/web/src/pages/admin/products/new.astro')).not.toMatch(/name="imageUrl"/);
  });
  it('the API ignores body.imageUrl and the feed only falls back to local uploads', () => {
    expect(ROUTE).not.toMatch(/const imageUrl = body\.imageUrl/);
    expect(read('apps/api/src/infrastructure/db/repositories/DrizzleSeoGrowthRepository.ts')).toMatch(/when p\.image_url like '\/uploads\/%' then p\.image_url end/);
  });
  it('an explicitly emptied subcategory / compare-at price is cleared', () => {
    expect(ROUTE).toMatch(/clearProductFields\(productId, \{ subcategory: clearSubcategory, compareAtPrice: clearCompareAt \}\)/);
    expect(edit).toMatch(/const subcategory = String\(form\.get\('subcategory'\) \?\? ''\)\.trim\(\);/);
  });
});

describe('photo upload reports what was stored', () => {
  it('counts only ASSIGNED/COVER and explains the rest', () => {
    const none = summariseProductUpload([{ assetId: '', url: '', slot: null, deduplicated: false, outcome: 'REJECTED', message: 'Rejected: not an image.' }]);
    expect(none).toEqual({ stored: 0, message: 'No photo was stored. Rejected: not an image.' });
    const some = summariseProductUpload([
      { assetId: 'a', url: '', slot: 1, deduplicated: false, outcome: 'COVER' },
      { assetId: 'b', url: '', slot: null, deduplicated: false, outcome: 'GALLERY_FULL' },
    ]);
    expect(some.stored).toBe(1);
    expect(some.message).toMatch(/1 of 2 photos stored/);
  });
  it('the route answers 422 when nothing was stored and passes use-case refusals through', () => {
    expect(ROUTE).toMatch(/code: 'NOTHING_STORED'/);
    expect(ROUTE).toMatch(/err instanceof ProductUploadError \? err\.message/);
  });
});
