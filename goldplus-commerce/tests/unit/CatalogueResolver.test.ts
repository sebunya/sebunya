/**
 * tests/unit/CatalogueResolver.test.ts
 *
 * Focused coverage for the browser-journey product resolver. These run without a
 * browser or a network so the failure modes are provable rather than incidental.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  CatalogueResolutionError,
  resolveApprovedProduct,
  selectDeterministicProduct,
} from '../e2e/support/catalogue-resolver';

const product = (slug: string, name: string) => ({ slug, name, priceUgx: 120000 });

describe('selectDeterministicProduct', () => {
  it('reads the collection from data and returns a usable product', () => {
    const resolved = selectDeterministicProduct({
      success: true,
      data: [product('heavy-duty-power-bank', 'Heavy Duty Power Bank')],
    });
    expect(resolved.slug).toBe('heavy-duty-power-bank');
    expect(resolved.name).toBe('Heavy Duty Power Bank');
  });

  it('is deterministic regardless of the order the API returns products in', () => {
    const forward = selectDeterministicProduct({
      data: [product('b-cable', 'B Cable'), product('a-charger', 'A Charger')],
    });
    const reversed = selectDeterministicProduct({
      data: [product('a-charger', 'A Charger'), product('b-cable', 'B Cable')],
    });
    expect(forward.slug).toBe(reversed.slug);
    expect(forward.slug).toBe('a-charger');
  });

  it('derives a stable search term from the product name', () => {
    expect(selectDeterministicProduct({ data: [product('x', 'Reinforced USB-C Cable')] }).searchTerm).toBe(
      'reinforced',
    );
  });

  it('fails clearly when the approved catalogue is empty', () => {
    expect(() => selectDeterministicProduct({ success: true, data: [] })).toThrow(CatalogueResolutionError);
    expect(() => selectDeterministicProduct({ success: true, data: [] })).toThrow(/catalogue is empty/i);
  });

  it('rejects data.items, the shape that caused the production zero-products incident', () => {
    expect(() => selectDeterministicProduct({ data: { items: [product('a', 'A')] } })).toThrow(
      /"data" is not an array.*data\.items/is,
    );
  });

  it('fails clearly when the collection key is missing entirely', () => {
    expect(() => selectDeterministicProduct({ success: true })).toThrow(/no "data" collection/i);
  });

  it('fails clearly on a malformed body', () => {
    expect(() => selectDeterministicProduct(null)).toThrow(/not an object/i);
    expect(() => selectDeterministicProduct('nope')).toThrow(/not an object/i);
  });

  it('ignores entries lacking a slug or a name and fails when none remain', () => {
    const resolved = selectDeterministicProduct({
      data: [{ slug: '', name: 'No slug' }, { slug: 'ok-item', name: 'Ok Item' }],
    });
    expect(resolved.slug).toBe('ok-item');

    expect(() => selectDeterministicProduct({ data: [{ slug: 'x' }, { name: 'y' }] })).toThrow(
      /no catalogue entry has both a slug and a name/i,
    );
  });
});

describe('resolveApprovedProduct', () => {
  it('requests the products collection from the configured API base', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [product('a-charger', 'A Charger')] }),
    });
    const resolved = await resolveApprovedProduct('http://127.0.0.1:3000/', fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:3000/products?limit=25');
    expect(resolved.slug).toBe('a-charger');
  });

  it('reports the status when the API rejects the request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) });
    await expect(
      resolveApprovedProduct('http://127.0.0.1:3000', fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/returned 503/);
  });

  it('reports an unreachable API rather than surfacing a bare network error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(
      resolveApprovedProduct('http://127.0.0.1:3000', fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow(/could not reach the test API/i);
  });
});
