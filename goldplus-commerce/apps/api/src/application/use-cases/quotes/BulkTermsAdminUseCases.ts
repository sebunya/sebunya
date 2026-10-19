import type { BulkTermsAdminRow, IBulkTermsRepository } from '../../ports/IBulkTermsRepository';
import { planTermsImport, validateTerms, type TermsImportPlan } from '../../../domain/quotes/BulkTermsImport';
import type { BulkUnit } from '../../../domain/quotes/BulkQuoteRequest';

/** Admin: how every product is bought in bulk, with its dealer price (secured). */
export class ListBulkTermsUseCase {
  constructor(private readonly terms: IBulkTermsRepository) {}
  execute(): Promise<BulkTermsAdminRow[]> {
    return this.terms.listForAdmin();
  }
}

export type UpdateBulkTermsResult =
  | { ok: true; before: BulkTermsAdminRow; after: { bulkUnit: BulkUnit; unitsPerCarton: number | null; dealerPriceUgx: number | null } }
  | { ok: false; code: 'NOT_FOUND' | 'BAD_INPUT'; message: string };

function optionalWhole(value: unknown): number | null | 'INVALID' {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[\s,_]/g, ''));
  return Number.isSafeInteger(n) ? n : 'INVALID';
}

export class UpdateBulkTermsUseCase {
  constructor(private readonly terms: IBulkTermsRepository) {}

  async execute(input: { productId: string; bulkUnit: unknown; unitsPerCarton: unknown; dealerPriceUgx: unknown }): Promise<UpdateBulkTermsResult> {
    const rows = await this.terms.listForAdmin();
    const before = rows.find((r) => r.productId === input.productId);
    if (!before) return { ok: false, code: 'NOT_FOUND', message: 'Product not found.' };
    if (input.bulkUnit !== 'carton' && input.bulkUnit !== 'piece') return { ok: false, code: 'BAD_INPUT', message: 'Sold by must be carton or piece.' };
    const units = optionalWhole(input.unitsPerCarton);
    const dealer = optionalWhole(input.dealerPriceUgx);
    if (units === 'INVALID') return { ok: false, code: 'BAD_INPUT', message: 'Pieces per carton must be a whole number.' };
    if (dealer === 'INVALID') return { ok: false, code: 'BAD_INPUT', message: 'The dealer price must be a whole number of shillings.' };
    const bulkUnit: BulkUnit = input.bulkUnit;
    const after = { bulkUnit, unitsPerCarton: bulkUnit === 'piece' ? null : units, dealerPriceUgx: dealer };
    const invalid = validateTerms(after, before.retailPriceUgx);
    if (invalid) return { ok: false, code: 'BAD_INPUT', message: invalid };
    const outcome = await this.terms.update(before.productId, after);
    if (outcome === 'not_found') return { ok: false, code: 'NOT_FOUND', message: 'Product not found.' };
    if (outcome === 'no_retail_price') return { ok: false, code: 'BAD_INPUT', message: 'This product has no retail price yet, so it cannot have a dealer price.' };
    return { ok: true, before, after };
  }
}

export type ImportBulkTermsResult = TermsImportPlan & { applied: boolean; appliedCount: number; failed: Array<{ sku: string; reason: string }> };

/**
 * Paste-in import of the owner's bulk terms. Without `apply` it only reports
 * what would change; with it, every change is written (each product all or
 * nothing) and the result says which, if any, failed.
 */
export class ImportBulkTermsUseCase {
  constructor(private readonly terms: IBulkTermsRepository) {}

  async execute(input: { text: unknown; apply: boolean }): Promise<ImportBulkTermsResult> {
    const text = typeof input.text === 'string' ? input.text.slice(0, 200_000) : '';
    const current = await this.terms.listForAdmin();
    const plan = planTermsImport(text, current);
    if (!input.apply) return { ...plan, applied: false, appliedCount: 0, failed: [] };
    let appliedCount = 0;
    const failed: Array<{ sku: string; reason: string }> = [];
    for (const change of plan.changes) {
      const outcome = await this.terms.update(change.productId, change.after);
      if (outcome === 'updated') appliedCount += 1;
      else failed.push({ sku: change.sku, reason: outcome === 'not_found' ? 'Product not found.' : 'No retail price yet.' });
    }
    return { ...plan, applied: true, appliedCount, failed };
  }
}
