/**
 * Bulk terms pasted from a spreadsheet: one product per line,
 *   SKU, sold by, pieces per carton, dealer price per piece
 * (owner, 2026-10-19: the dealer price column comes from the owner's workbook).
 *
 * Pure. An empty cell leaves that field as it is; "none" clears a dealer price.
 * Every line that cannot be used is reported with its reason, none dropped.
 */
import type { BulkUnit } from './BulkQuoteRequest';

export const MAX_IMPORT_LINES = 1000;
export const MIN_UNITS_PER_CARTON = 2;
export const MAX_UNITS_PER_CARTON = 10_000;

export interface CurrentTerms {
  productId: string;
  sku: string;
  bulkUnit: BulkUnit;
  unitsPerCarton: number | null;
  dealerPriceUgx: number | null;
  retailPriceUgx: number | null;
}

export interface TermsChangeRow {
  productId: string;
  sku: string;
  before: { bulkUnit: BulkUnit; unitsPerCarton: number | null; dealerPriceUgx: number | null };
  after: { bulkUnit: BulkUnit; unitsPerCarton: number | null; dealerPriceUgx: number | null };
}

export interface TermsImportProblem {
  line: number;
  source: string;
  reason: string;
}

export interface TermsImportPlan {
  changes: TermsChangeRow[];
  unchanged: number;
  problems: TermsImportProblem[];
}

const norm = (sku: string) => sku.toUpperCase().replace(/[^A-Z0-9]/g, '');

function cells(line: string): string[] {
  const sep = line.includes('\t') ? '\t' : line.includes(';') && !line.includes(',') ? ';' : ',';
  return line.split(sep).map((c) => c.trim().replace(/^"(.*)"$/, '$1').trim());
}

function wholeNumber(cell: string): number | null {
  const digits = cell.replace(/ugx|shs?|[\s,_]/gi, '');
  return /^\d{1,11}$/.test(digits) ? Number(digits) : null;
}

/** A header row names its columns; a data row starts with a SKU and has numbers. */
function isHeader(c: string[]): boolean {
  return /sku|code/i.test(c[0] ?? '') && !/\d{2,}/.test((c[3] ?? '') + (c[2] ?? ''));
}

export function validateTerms(t: { bulkUnit: BulkUnit; unitsPerCarton: number | null; dealerPriceUgx: number | null }, retailPriceUgx: number | null): string | null {
  if (t.bulkUnit === 'carton' && t.unitsPerCarton !== null && (t.unitsPerCarton < MIN_UNITS_PER_CARTON || t.unitsPerCarton > MAX_UNITS_PER_CARTON)) {
    return `Pieces per carton must be from ${MIN_UNITS_PER_CARTON} to ${MAX_UNITS_PER_CARTON.toLocaleString('en-US')}.`;
  }
  if (t.dealerPriceUgx !== null) {
    if (t.dealerPriceUgx < 1) return 'The dealer price must be more than zero.';
    if (retailPriceUgx === null) return 'This product has no retail price yet, so it cannot have a dealer price.';
    if (t.dealerPriceUgx > retailPriceUgx) return `The dealer price is above the retail price (UGX ${retailPriceUgx.toLocaleString('en-US')}).`;
  }
  return null;
}

export function planTermsImport(input: string, current: CurrentTerms[]): TermsImportPlan {
  const bySku = new Map(current.map((c) => [norm(c.sku), c]));
  const changes: TermsChangeRow[] = [];
  const problems: TermsImportProblem[] = [];
  const seen = new Set<string>();
  let unchanged = 0;
  const lines = input.split(/\r?\n/).slice(0, MAX_IMPORT_LINES + 1);
  lines.forEach((raw, index) => {
    const source = raw.trim().slice(0, 200);
    if (!source) return;
    const c = cells(source);
    if (index === 0 && isHeader(c)) return;
    const problem = (reason: string) => problems.push({ line: index + 1, source, reason });
    const product = bySku.get(norm(c[0] ?? ''));
    if (!product) return problem('No product has this SKU.');
    if (seen.has(product.productId)) return problem('This SKU appears more than once; only its first line is used.');
    seen.add(product.productId);

    const unitCell = (c[1] ?? '').toLowerCase();
    let bulkUnit = product.bulkUnit;
    if (unitCell) {
      if (/^(carton|cartons|ctn|box|boxes)$/.test(unitCell)) bulkUnit = 'carton';
      else if (/^(piece|pieces|pcs?|unit|units)$/.test(unitCell)) bulkUnit = 'piece';
      else return problem('Sold by must be carton or piece.');
    }
    // Comma-separated with a thousands comma in a number ("50, 21,000") splits into five cells and the price read
    // as UGX 21. Four columns at most; anything beyond is a number cut in two (2026-10-22).
    if (c.length > 4 && c.slice(4).some((x) => x !== '')) return problem('Too many columns: write numbers without commas (21000), or paste straight from the sheet.');
    let unitsPerCarton = product.unitsPerCarton;
    if (c[2]) {
      const n = wholeNumber(c[2]);
      if (n === null) return problem('Pieces per carton must be a whole number.');
      unitsPerCarton = n;
    }
    if (bulkUnit === 'piece') unitsPerCarton = null;
    let dealerPriceUgx = product.dealerPriceUgx;
    if (c[3]) {
      if (/^(none|clear|-)$/i.test(c[3])) dealerPriceUgx = null;
      else {
        const n = wholeNumber(c[3]);
        if (n === null) return problem('The dealer price must be a whole number of shillings.');
        dealerPriceUgx = n;
      }
    }
    const after = { bulkUnit, unitsPerCarton, dealerPriceUgx };
    const invalid = validateTerms(after, product.retailPriceUgx);
    if (invalid) return problem(invalid);
    const before = { bulkUnit: product.bulkUnit, unitsPerCarton: product.unitsPerCarton, dealerPriceUgx: product.dealerPriceUgx };
    if (before.bulkUnit === after.bulkUnit && before.unitsPerCarton === after.unitsPerCarton && before.dealerPriceUgx === after.dealerPriceUgx) {
      unchanged += 1;
      return;
    }
    changes.push({ productId: product.productId, sku: product.sku, before, after });
  });
  if (lines.length > MAX_IMPORT_LINES) problems.push({ line: MAX_IMPORT_LINES + 1, source: '', reason: `Only the first ${MAX_IMPORT_LINES} lines are read.` });
  return { changes, unchanged, problems };
}
