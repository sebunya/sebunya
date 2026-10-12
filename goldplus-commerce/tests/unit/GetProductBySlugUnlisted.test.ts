import { describe, expect, it } from 'vitest';
import { GetProductBySlugUseCase } from '../../apps/api/src/application/use-cases/products/GetProductBySlugUseCase';

/**
 * An old product URL answers honestly: a product that was on sale and is now
 * draft or inactive is NOT_LISTED with its name and range; one the shop never
 * published, or never had, stays a bare NOT_FOUND (no draft import leaks).
 */
const products = { findPublicViewBySlug: async () => null } as never;

describe('GetProductBySlugUseCase for products that are off sale', () => {
  it('reports a once-published product as NOT_LISTED with its name and range', async () => {
    const uc = new GetProductBySlugUseCase(products, { findUnlistedBySlug: async (slug) => (slug === 'bl-49ci-battery' ? { name: 'GoldPlus Battery GP-49CI', categorySlug: 'power-devices', categoryName: 'Power Devices' } : null) });
    expect(await uc.execute('bl-49ci-battery')).toEqual({ ok: false, code: 'NOT_LISTED', notice: { name: 'GoldPlus Battery GP-49CI', categorySlug: 'power-devices', categoryName: 'Power Devices' } });
    expect(await uc.execute('never-published')).toEqual({ ok: false, code: 'NOT_FOUND' });
  });

  it('stays a plain NOT_FOUND without a reader, or when the reader fails', async () => {
    expect(await new GetProductBySlugUseCase(products).execute('x')).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(await new GetProductBySlugUseCase(products, { findUnlistedBySlug: async () => { throw new Error('db down'); } }).execute('x')).toEqual({ ok: false, code: 'NOT_FOUND' });
  });
});
