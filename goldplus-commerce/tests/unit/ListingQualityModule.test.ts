import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { planPhotoAttachments, tokens, codeKey } from '../../apps/api/src/domain/media/PhotoCodeMatcher';
import { UpdateProductListingUseCase, type ProductListingWriter } from '../../apps/api/src/application/use-cases/products/UpdateProductListingUseCase';
import { titleIsCodeOnly } from '../../apps/api/src/application/use-cases/seo-growth/MerchantFeedUseCase';
import type { IAttributeRepository, PersistedAttribute, PersistedAttributeValue } from '../../apps/api/src/application/ports/IAttributeRepository';

const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');

describe('photos match products by code', () => {
  const products = [
    { id: 'c10', name: 'GoldPlus Charger GP-C10', category: 'Power Devices', codes: ['GP-C10', 'GP-C10'] },
    { id: 'w04', name: 'GoldPlus Bluetooth GP-W04', category: 'Sound Devices', codes: ['GP-W04', 'GP - W04'] },
    { id: 'gp04', name: 'GoldPlus Bluetooth GP04', category: 'Sound Devices', codes: ['GP04', 'GP04'] },
    { id: 'p07', name: 'GoldPlus Power Bank GP-P07', category: 'Power Devices', codes: ['GP-P07-PB', 'GP - P07 PB'] },
  ];
  it('tokenises by letter/digit runs and compares digits by value', () => {
    expect(tokens('gp-001')).toEqual(['gp', '1']);
    expect(tokens('GP - P07 PB')).toEqual(['gp', 'p', '7', 'pb']);
    expect(codeKey('GP04')).toEqual(['4']);
  });
  it('matches whole-token codes with free separators, extras included, and never inside another token', () => {
    const plan = planPhotoAttachments(['GP-C10.webp', 'gp c10 2.jpg', 'goldplus-earbuds-gp-004.webp', 'GP-C100.webp', 'random.png'], products);
    expect(plan.matched.map((m) => [m.file, m.productId])).toEqual([['GP-C10.webp', 'c10'], ['goldplus-earbuds-gp-004.webp', 'gp04'], ['gp c10 2.jpg', 'c10']]);
    expect(plan.unmatched).toEqual(['GP-C100.webp', 'random.png']);
  });
  it('refuses a filename that names a different kind of product', () => {
    const plan = planPhotoAttachments(['goldplus-slim-power-bank-gp-04.webp'], products);
    expect(plan.matched).toEqual([]);
    expect(plan.refused[0]).toMatchObject({ file: 'goldplus-slim-power-bank-gp-04.webp', productName: 'GoldPlus Bluetooth GP04' });
  });
  it('the longest code wins and equal lengths are ambiguous, not guessed', () => {
    const plan = planPhotoAttachments(['gp-p07-pb.webp'], [...products, { id: 'p7x', name: 'Other GP-P07', category: 'Power Devices', codes: ['GP-P07'] }]);
    expect(plan.matched[0]?.productId).toBe('p07');
    const tie = planPhotoAttachments(['gp-x.webp'], [{ id: 'a', name: 'A GP-X', category: '', codes: ['GP-X'] }, { id: 'b', name: 'B GP-X', category: '', codes: ['GP-X'] }]);
    expect(tie.ambiguous[0]?.candidates).toEqual(['A GP-X', 'B GP-X']);
  });
  it('the ops script uses the same matcher as the admin', () => {
    expect(read('apps/api/src/scripts/attach-images-by-code.ts')).toContain("import { planPhotoAttachments } from '../domain/media/PhotoCodeMatcher';");
  });
});

class FakeAttributes implements IAttributeRepository {
  defs: PersistedAttribute[] = []; values: PersistedAttributeValue[] = [];
  async findByCategoryId(categoryId: string) { return this.defs.filter((d) => d.categoryId === categoryId); }
  async findById(id: string) { return this.defs.find((d) => d.id === id) ?? null; }
  async findBySlugInCategory(categoryId: string, slug: string) { return this.defs.find((d) => d.categoryId === categoryId && d.slug === slug) ?? null; }
  async define(input: { categoryId: string; slug: string; name: string; unit: string | null; isRequired: boolean; displayOrder: number }) { const a = { id: `a${this.defs.length + 1}`, ...input }; this.defs.push(a); return a; }
  async findValuesByProductId(productId: string) { return this.values.filter((v) => v.productId === productId); }
  async setValue(input: PersistedAttributeValue) { this.values = this.values.filter((v) => !(v.productId === input.productId && v.attributeId === input.attributeId)); this.values.push(input); return input; }
}

describe('the listing use case owns title, descriptions, specs and the feed switch', () => {
  const writer = () => {
    const state = { text: [] as unknown[], feed: [] as boolean[] };
    const w: ProductListingWriter = {
      async findListingTarget(id) { return id === 'p1' ? { id, categoryId: 'cat-power' } : null; },
      async updateListingText(_id, patch) { state.text.push(patch); },
      async setFeedEligibility(_id, e) { state.feed.push(e); },
    };
    return { w, state };
  };
  it('defines a missing attribute in the product category, sets verified values, writes text and feed', async () => {
    const attrs = new FakeAttributes(); const { w, state } = writer();
    const uc = new UpdateProductListingUseCase(w, attrs);
    const r = await uc.execute({ productId: 'p1', name: 'GoldPlus GP-C10 100W USB-C PD Super Fast Charger', longDescription: 'Real text.', isFeedEligible: false,
      specs: [{ name: 'Output power', value: '100', unit: 'W', isVerified: true }, { name: 'Port', value: 'USB-C', isVerified: true }, { name: '', value: '' }] });
    expect(r).toEqual({ ok: true, changed: { text: ['name', 'longDescription'], specs: 2, feed: true } });
    expect(attrs.defs.map((d) => [d.slug, d.unit])).toEqual([['output-power', 'W'], ['port', null]]);
    expect(attrs.values).toEqual([{ productId: 'p1', attributeId: 'a1', value: '100', isVerified: true }, { productId: 'p1', attributeId: 'a2', value: 'USB-C', isVerified: true }]);
    expect(state.text).toEqual([{ name: 'GoldPlus GP-C10 100W USB-C PD Super Fast Charger', longDescription: 'Real text.' }]);
    expect(state.feed).toEqual([false]);
    // Second write reuses the attribute instead of defining a duplicate.
    await uc.execute({ productId: 'p1', specs: [{ name: 'Output Power', value: '65', unit: 'W', isVerified: false }] });
    expect(attrs.defs.length).toBe(2);
    expect(attrs.values.find((v) => v.attributeId === 'a1')).toEqual({ productId: 'p1', attributeId: 'a1', value: '65', isVerified: false });
  });
  it('validates before it writes anything', async () => {
    const attrs = new FakeAttributes(); const { w, state } = writer();
    const uc = new UpdateProductListingUseCase(w, attrs);
    expect(await uc.execute({ productId: 'nope', name: 'x' })).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await uc.execute({ productId: 'p1', name: 'ab' })).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect(await uc.execute({ productId: 'p1', name: 'x'.repeat(151) })).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect(await uc.execute({ productId: 'p1', name: 'Fine title', specs: [{ name: 'Only a name', value: '' }] })).toMatchObject({ ok: false, code: 'BAD_INPUT' });
    expect(state.text).toEqual([]); expect(attrs.values).toEqual([]);
  });
});

describe('a code-only title is flagged, a spec-bearing one is not', () => {
  it.each([
    ['GoldPlus Cable GP-L01V', 'GP-L01V', 'GP-L01V', true],
    ['GoldPlus Charger GP-C10', 'GP-C10', 'GP-C10', true],
    ['GoldPlus Bluetooth GP-W04', 'GP-W04', 'GP-W04', true],
    ['GoldPlus Memory Card 32GB', 'GP-32GB-MC', 'GP-32GB-MC', false],
    ['GoldPlus GP-C10 100W USB-C PD Super Fast Charger', 'GP-C10', 'GP-C10', false],
    ['GoldPlus GP-L01 Micro-USB Fast Charging Cable, 1 m, 3A', 'GP-L01V', 'GP-L01V', false],
  ])('%s → %s', (name, model, sku, expected) => {
    expect(titleIsCodeOnly(name, model, sku)).toBe(expected);
  });
});
