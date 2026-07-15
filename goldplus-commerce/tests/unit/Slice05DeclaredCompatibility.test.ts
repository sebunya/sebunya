import { describe, it, expect } from 'vitest';
import {
  validateCompatibilityMapping,
  resolveCompatibility,
  verdictLabel,
  CompatibilityMapping,
} from '../../apps/api/src/domain/products/Compatibility';
import {
  UpsertCompatibilityMappingUseCase,
  GetProductCompatibilityUseCase,
} from '../../apps/api/src/application/use-cases/products/CompatibilityUseCases';
import { ICompatibilityMappingRepository } from '../../apps/api/src/application/ports/ICompatibilityMappingRepository';
import { IProductRepository, ProductWithPrice } from '../../apps/api/src/application/ports/IProductRepository';

const mapping = (over: Partial<CompatibilityMapping> = {}): CompatibilityMapping => ({
  id: 'm1',
  productId: 'p1',
  targetProductId: 'p2',
  verdict: 'compatible',
  note: null,
  enabled: true,
  ...over,
});

function fakeMappings(rows: CompatibilityMapping[]): ICompatibilityMappingRepository & { saved: CompatibilityMapping[] } {
  const saved = [...rows];
  return {
    saved,
    async listAll() { return saved; },
    async listForProduct(productId) { return saved.filter((m) => m.productId === productId && m.enabled); },
    async upsert(input) {
      const row = { id: `m-${saved.length + 1}`, ...input };
      saved.push(row);
      return row;
    },
    async delete(id) { return saved.some((m) => m.id === id); },
  };
}

function product(id: string, name: string, slug = `slug-${id}`): ProductWithPrice {
  return { entity: { id, name, slug, sku: `S-${id}`, modelNumber: `M-${id}` } as any, retailPriceUgx: 5000, categoryName: null, images: [], attributeValues: [] };
}

function fakeProducts(rows: ProductWithPrice[]): IProductRepository {
  return {
    async findPublicViewBySlug(slug) { return rows.find((r) => (r.entity as any).slug === slug) ?? null; },
    async findPublicViewList(opts) { return rows.filter((r) => (opts?.ids ?? []).includes((r.entity as any).id)); },
  };
}

describe('Compatibility domain (Slice 5)', () => {
  it("never accepts 'unknown' as a declared verdict", () => {
    expect(validateCompatibilityMapping({ productId: 'a', targetProductId: 'b', verdict: 'unknown' }).ok).toBe(false);
  });

  it('rejects self-mappings and missing products', () => {
    expect(validateCompatibilityMapping({ productId: 'a', targetProductId: 'a', verdict: 'exact' }).ok).toBe(false);
    expect(validateCompatibilityMapping({ productId: '', targetProductId: 'b', verdict: 'exact' }).ok).toBe(false);
  });

  it('requires a note for conditional verdicts', () => {
    expect(validateCompatibilityMapping({ productId: 'a', targetProductId: 'b', verdict: 'conditional' }).ok).toBe(false);
    expect(validateCompatibilityMapping({ productId: 'a', targetProductId: 'b', verdict: 'conditional', note: 'Needs USB-C cable' }).ok).toBe(true);
  });

  it('declared verdicts always beat heuristics — including incompatible over HIGH', () => {
    const declared = mapping({ verdict: 'incompatible' });
    const resolved = resolveCompatibility(declared, { compatible: true, confidence: 'HIGH', reasons: ['MATCHING_CONNECTOR'] });
    expect(resolved.verdict).toBe('incompatible');
    expect(resolved.source).toBe('declared');
  });

  it('heuristics only soften: HIGH -> compatible, MEDIUM -> conditional, none -> unknown', () => {
    expect(resolveCompatibility(null, { compatible: true, confidence: 'HIGH', reasons: [] }).verdict).toBe('compatible');
    expect(resolveCompatibility(null, { compatible: true, confidence: 'MEDIUM', reasons: [] }).verdict).toBe('conditional');
    expect(resolveCompatibility(null, null).verdict).toBe('unknown');
    expect(resolveCompatibility(mapping({ enabled: false }), null).verdict).toBe('unknown');
  });

  it('labels the unknown verdict truthfully', () => {
    expect(verdictLabel('unknown')).toBe('Compatibility not verified');
    expect(verdictLabel('incompatible')).toBe('Not compatible');
  });
});

describe('Compatibility use cases (Slice 5)', () => {
  it('refuses mappings whose products are not publicly visible', async () => {
    const uc = new UpsertCompatibilityMappingUseCase(fakeMappings([]), fakeProducts([product('p1', 'Charger')]));
    const result = await uc.execute({ productId: 'p1', targetProductId: 'ghost', verdict: 'exact' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('PRODUCT_NOT_PUBLIC');
  });

  it('serves PDP guidance from declared mappings only, hiding unpublished targets', async () => {
    const repo = fakeMappings([
      mapping({ id: 'm1', targetProductId: 'p2', verdict: 'exact' }),
      mapping({ id: 'm2', targetProductId: 'ghost', verdict: 'compatible' }), // target not public
      mapping({ id: 'm3', targetProductId: 'p3', enabled: false }), // disabled
    ]);
    const uc = new GetProductCompatibilityUseCase(repo, fakeProducts([product('p1', 'Charger'), product('p2', 'Cable'), product('p3', 'Power Bank')]));
    const entries = await uc.execute({ slug: 'slug-p1' });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ productId: 'p2', verdict: 'exact', label: 'Exact fit' });
  });

  it('returns nothing for unknown slugs', async () => {
    const uc = new GetProductCompatibilityUseCase(fakeMappings([mapping()]), fakeProducts([]));
    expect(await uc.execute({ slug: 'missing' })).toEqual([]);
  });
});
