import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { proposeUploadSlots } from '../../apps/api/src/domain/products/MediaUploadSlots';

const ROOT = resolve(__dirname, '../..');
const read = (f: string) => readFileSync(resolve(ROOT, f), 'utf8');
const between = (src: string, start: string, end: string) => {
  const i = src.indexOf(start);
  expect(i, start).toBeGreaterThan(-1);
  return src.slice(i, src.indexOf(end, i + start.length));
};

describe('admin product PUT keeps what the body leaves out', () => {
  const src = read('apps/api/src/interfaces/http/routes/admin/products.ts');
  const put = between(src, "const imageUrl = existingProduct.imageUrl;", 'try {\n    const categoriesList');

  it('approvalStatus and active default to the stored values, not draft/active', () => {
    expect(put).toMatch(/const active = hasKey\('active'\) \? body\.active !== false : existingProduct\.active;/);
    expect(put).toMatch(/const approvalStatus = hasKey\('approvalStatus'\) \? .* : String\(existingProduct\.approvalStatus\);/);
  });

  it('a failed price-tier read is a 503, never "no stored tiers"', () => {
    expect(put).not.toMatch(/getPriceTiers\(productId\)\.catch/);
    expect(put).toMatch(/PRICE_TIERS_UNAVAILABLE/);
    expect(put).toMatch(/, 503\);/);
  });
});

describe('taxonomy: only the save itself can answer INVALID_TAXONOMY', () => {
  it('the audit write runs after the INVALID_TAXONOMY catch and has its own catch', () => {
    const src = read('apps/api/src/interfaces/http/routes/admin/taxonomy.ts');
    const put = between(src, "routes.put('/'", 'export default routes;');
    const invalid = put.indexOf("code: 'INVALID_TAXONOMY'");
    const audit = put.indexOf('createAuditLogUseCase.execute');
    expect(invalid).toBeGreaterThan(-1);
    expect(invalid).toBeLessThan(audit);
    expect(put.match(/code: 'INVALID_TAXONOMY'/g)).toHaveLength(1);
    expect(put.slice(audit)).toMatch(/catch \(err\) \{\s*auditRecorded = false;/);
  });
});

describe('media costs: one validation, one currency rule, no silent truncation', () => {
  const src = read('apps/api/src/interfaces/http/routes/admin/recommendations.ts');

  it('the single-row POST uses validateMediaCostRow and the currency-conflict check', () => {
    const single = between(src, 'routes.post("/media-costs", requirePermissions', '\n});');
    expect(single).toMatch(/validateMediaCostRow\(body\)/);
    expect(single).toMatch(/conflictingSpendCurrencies\(f\.currency\)/);
    expect(single.indexOf('conflictingSpendCurrencies')).toBeLessThan(single.indexOf('insertMediaCostFact'));
    expect(single).not.toMatch(/FIELD_CAPS/);
  });

  it('a correction must be in the stored currency', () => {
    const correct = between(src, 'routes.post("/media-costs/correct"', '\n});');
    expect(correct).toMatch(/currency: f\.currency,/);
    expect(correct).toMatch(/CURRENCY_MISMATCH/);
    const repo = read('apps/api/src/infrastructure/db/repositories/DrizzleRecommendationCommercialRepository.ts');
    expect(between(repo, 'async correctMediaCostFact(', 'async insertMediaCostFact(')).toMatch(/b\.currency = \$\{input\.currency \?\? null\}::text/);
  });

  it('an over-cap batch is refused, not truncated (spend and product cost)', () => {
    const batch = between(src, 'routes.post("/media-costs/batch"', '\n});');
    expect(batch).not.toMatch(/\.slice\(0, 5_000\)/);
    expect(batch).toMatch(/rows\.length > MAX_MEDIA_COST_BATCH_ROWS[^]*BATCH_TOO_LARGE/);
    const costs = read('apps/api/src/interfaces/http/routes/admin/product-costs.ts');
    expect(costs).not.toMatch(/slice\(0, MAX_ROWS\)/);
    expect(costs.match(/if \(overCap !== null\) return c\.json\(tooManyRowsResponse\(overCap\), 413\);/g)).toHaveLength(2);
  });
});

describe('media upload: unslotted files take free slots no explicit file claimed', () => {
  it('free=[3,4], A unslotted, B asks for 3 -> A gets 4', () => {
    expect(proposeUploadSlots(2, [undefined, 3], new Set([1, 2]))).toEqual([4, 3]);
  });

  it('free=[1], explicit 2 (replace) then unslotted -> unslotted gets 1', () => {
    expect(proposeUploadSlots(2, [2, Number.NaN], new Set([2, 3, 4]))).toEqual([2, 1]);
  });

  it('no slots asked: the free slots in order; too many files leave null', () => {
    expect(proposeUploadSlots(3, [], new Set([2]))).toEqual([1, 3, 4]);
    expect(proposeUploadSlots(2, [], new Set([1, 2, 3]))).toEqual([4, null]);
  });

  it('the route uses it', () => {
    expect(read('apps/api/src/interfaces/http/routes/admin/products.ts')).toMatch(/proposeUploadSlots\(files\.length, slots, taken\)/);
  });
});

describe('remove-pin is an audited address edit', () => {
  it('goes through UpdateAddressUseCase, not the repository directly', () => {
    const src = read('apps/api/src/interfaces/http/routes/account.ts');
    const route = between(src, "routes.post('/addresses/:id/remove-pin'", '\n});');
    expect(route).toMatch(/new UpdateAddressUseCase\(registry\.addressRepo, registry\.addressAuditRepo\)/);
    expect(route).not.toMatch(/addressRepo\.updateForUser/);
  });
});
