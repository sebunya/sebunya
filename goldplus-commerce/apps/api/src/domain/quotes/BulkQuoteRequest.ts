/**
 * A bulk request: one buyer, many products, cartons (or pieces) of each, and
 * optionally a budget. A budget may come with no products at all, and the team
 * builds the list.
 *
 * Pure domain (no framework, no database). The client names products by id and
 * says how many cartons or pieces; everything else on a line (name, code, carton
 * size, bulk price) is a SNAPSHOT the server takes at the moment of the request.
 * A price the client sends is never read. Bulk is supplied to order: website
 * stock is never read for the buyer and never held.
 *
 * See docs/bulk-buying/DESIGN.md.
 */

export type QuoteRequestStatus = 'new' | 'quoted' | 'won' | 'lost' | 'expired';
export const QUOTE_REQUEST_STATUSES: readonly QuoteRequestStatus[] = ['new', 'quoted', 'won', 'lost', 'expired'];

export type BulkBuyerType = 'retail' | 'wholesale' | 'corporate' | 'dealer';
export const BULK_BUYER_TYPES: readonly BulkBuyerType[] = ['retail', 'wholesale', 'corporate', 'dealer'];

export type LineAvailability = 'in_stock' | 'out_of_stock' | 'pre_order' | 'unknown';

/**
 * How a product is bought in bulk (owner, 2026-10-19): by the carton, or by the
 * piece for flash drives and memory cards. One carton is the smallest bulk
 * order of a carton product; anything smaller goes through the shop at retail.
 */
export type BulkUnit = 'carton' | 'piece';
export type PriceBasis = 'list' | 'dealer';

/** Enough for the whole catalogue (192 products today) with room to grow. */
export const MAX_BULK_LINES = 200;
/** Owner: up to 500 cartons of a product from the page; more is still taken, and the team confirms supply. */
export const SELF_SERVE_MAX_CARTONS = 500;
/** A sanity bound, not a business limit: stops a typo of extra zeros. */
export const MAX_CARTONS_PER_LINE = 10_000;
/** Products bought by the piece. */
export const MAX_PIECES_PER_LINE = 50_000;
/** Validation before the catalogue says which unit a product uses. */
const MAX_COUNT_ANY_UNIT = Math.max(MAX_CARTONS_PER_LINE, MAX_PIECES_PER_LINE);

/** A buyer's budget, whole shillings. */
export const MIN_BUDGET_UGX = 10_000;
export const MAX_BUDGET_UGX = 10_000_000_000;

export interface BulkLineInput {
  productId: string;
  /** In the product's bulk unit: cartons, or pieces for a piece product. */
  count: number;
}

/** What the server reads about one product. Never from the client. */
export interface CatalogueEntry {
  productId: string;
  name: string;
  /** SKU first, else model number; null when the catalogue has neither. */
  code: string | null;
  bulkUnit: BulkUnit;
  /** Pieces in a carton; null when not entered yet (the team confirms it). */
  unitsPerCarton: number | null;
  /** Bulk (dealer) price per piece, UGX; null when none is set. */
  bulkPriceUgx: number | null;
  /** Kept for the team only: bulk orders are supplied to order, never from website stock. */
  availability: LineAvailability;
}

export interface BulkQuoteLine {
  lineNo: number;
  productId: string | null;
  productCode: string | null;
  productName: string;
  unitKind: BulkUnit;
  /** Cartons or pieces as the buyer chose them; null on lines from before 0195. */
  unitCount: number | null;
  unitsPerCarton: number | null;
  /** Total pieces; null when the carton size was not known. */
  quantity: number | null;
  /** Per piece. 'dealer' on bulk lines, 'list' (retail) on lines from before 0195. */
  unitPriceUgx: number | null;
  lineTotalUgx: number | null;
  priceBasis: PriceBasis;
  /** Over 500 cartons: taken, and the team confirms supply. */
  aboveSelfServe: boolean;
  availability: LineAvailability;
}

export interface BulkQuoteTotals {
  lineCount: number;
  /** Pieces on lines where the count of pieces is known. */
  totalUnits: number;
  totalCartons: number;
  /** Sum of priced lines only. */
  estimatedTotalUgx: number;
  pricedLineCount: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LineValidation =
  | { ok: true; lines: BulkLineInput[] }
  | { ok: false; code: 'NO_LINES' | 'TOO_MANY_LINES' | 'BAD_LINE'; message: string };

/**
 * Checks the shape of what the client sent and merges repeats of one product.
 * Order is the buyer's order (first appearance). An empty list is allowed only
 * when the caller says so (a budget request the team builds). Nothing here
 * trusts a type.
 */
export function validateBulkLines(raw: unknown, opts: { allowEmpty?: boolean } = {}): LineValidation {
  if (opts.allowEmpty && (raw === undefined || raw === null || (Array.isArray(raw) && raw.length === 0))) {
    return { ok: true, lines: [] };
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, code: 'NO_LINES', message: 'Add at least one product, or tell us your budget.' };
  }
  // Checked on the raw input too, so a huge array is refused before any work.
  if (raw.length > MAX_BULK_LINES * 2) {
    return { ok: false, code: 'TOO_MANY_LINES', message: `A bulk request can hold up to ${MAX_BULK_LINES} products.` };
  }
  const merged = new Map<string, number>();
  for (const item of raw) {
    const productId = typeof (item as { productId?: unknown })?.productId === 'string'
      ? ((item as { productId: string }).productId).trim().toLowerCase()
      : '';
    const count = (item as { count?: unknown })?.count;
    if (!UUID.test(productId)) {
      return { ok: false, code: 'BAD_LINE', message: 'One of the products could not be read. Reload the page and try again.' };
    }
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_COUNT_ANY_UNIT) {
      return { ok: false, code: 'BAD_LINE', message: 'Each line needs a whole number of cartons, or of pieces for flash drives and memory cards.' };
    }
    merged.set(productId, Math.min(MAX_COUNT_ANY_UNIT, (merged.get(productId) ?? 0) + count));
  }
  if (merged.size > MAX_BULK_LINES) {
    return { ok: false, code: 'TOO_MANY_LINES', message: `A bulk request can hold up to ${MAX_BULK_LINES} products.` };
  }
  return { ok: true, lines: [...merged.entries()].map(([productId, count]) => ({ productId, count })) };
}

/** Pieces for a count in a product's unit; null when a carton's size is not known. */
export function piecesFor(unit: BulkUnit, count: number, unitsPerCarton: number | null): number | null {
  if (unit === 'piece') return count;
  return unitsPerCarton && unitsPerCarton > 0 ? count * unitsPerCarton : null;
}

export type SnapshotResult =
  | { ok: true; lines: BulkQuoteLine[]; totals: BulkQuoteTotals }
  | { ok: false; code: 'PRODUCTS_UNAVAILABLE'; productIds: string[] }
  | { ok: false; code: 'COUNT_TOO_LARGE'; productIds: string[] };

const positiveInt = (n: number | null | undefined): number | null =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : null;

/**
 * Turns validated lines into snapshot lines from the server's catalogue read.
 * A product missing from the read is not on sale: the whole request is refused
 * with the offending ids, so the buyer is told rather than quietly short-changed.
 * Prices are the bulk (dealer) price per piece; a line without one, or without a
 * known carton size, is sent unpriced and the team prices it.
 */
export function snapshotBulkLines(lines: BulkLineInput[], catalogue: CatalogueEntry[]): SnapshotResult {
  const byId = new Map(catalogue.map((entry) => [entry.productId.toLowerCase(), entry]));
  const missing = lines.filter((line) => !byId.has(line.productId)).map((line) => line.productId);
  if (missing.length > 0) return { ok: false, code: 'PRODUCTS_UNAVAILABLE', productIds: missing };

  const tooLarge = lines.filter((line) => {
    const entry = byId.get(line.productId) as CatalogueEntry;
    return line.count > (entry.bulkUnit === 'piece' ? MAX_PIECES_PER_LINE : MAX_CARTONS_PER_LINE);
  });
  if (tooLarge.length > 0) return { ok: false, code: 'COUNT_TOO_LARGE', productIds: tooLarge.map((l) => l.productId) };

  const out: BulkQuoteLine[] = lines.map((line, index) => {
    const entry = byId.get(line.productId) as CatalogueEntry;
    const unitsPerCarton = entry.bulkUnit === 'carton' ? positiveInt(entry.unitsPerCarton) : null;
    const quantity = piecesFor(entry.bulkUnit, line.count, unitsPerCarton);
    const price = positiveInt(entry.bulkPriceUgx);
    return {
      lineNo: index + 1,
      productId: entry.productId,
      productCode: entry.code ? entry.code.slice(0, 120) : null,
      productName: entry.name.slice(0, 255),
      unitKind: entry.bulkUnit,
      unitCount: line.count,
      unitsPerCarton,
      quantity,
      unitPriceUgx: price,
      lineTotalUgx: price === null || quantity === null ? null : price * quantity,
      priceBasis: 'dealer',
      aboveSelfServe: entry.bulkUnit === 'carton' && line.count > SELF_SERVE_MAX_CARTONS,
      availability: entry.availability,
    };
  });
  return { ok: true, lines: out, totals: totalsOf(out) };
}

export function totalsOf(
  lines: Array<Pick<BulkQuoteLine, 'quantity' | 'lineTotalUgx'> & Partial<Pick<BulkQuoteLine, 'unitKind' | 'unitCount'>>>,
): BulkQuoteTotals {
  let totalUnits = 0;
  let totalCartons = 0;
  let estimatedTotalUgx = 0;
  let pricedLineCount = 0;
  for (const line of lines) {
    if (typeof line.quantity === 'number') totalUnits += line.quantity;
    if (line.unitKind === 'carton' && typeof line.unitCount === 'number') totalCartons += line.unitCount;
    if (typeof line.lineTotalUgx === 'number') {
      estimatedTotalUgx += line.lineTotalUgx;
      pricedLineCount += 1;
    }
  }
  return { lineCount: lines.length, totalUnits, totalCartons, estimatedTotalUgx, pricedLineCount };
}

/**
 * A budget in whole shillings, or null for "not given", or 'INVALID'.
 * Accepts what people type: "5,000,000", "5 000 000", "UGX 5000000".
 */
export function parseBudget(raw: unknown): number | null | 'INVALID' {
  if (raw === undefined || raw === null || raw === '') return null;
  const digits = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.replace(/ugx|shs?|[\s,_]/gi, '') : '';
  if (!/^\d{1,11}$/.test(digits)) return 'INVALID';
  const n = Number(digits);
  if (!Number.isSafeInteger(n) || n < MIN_BUDGET_UGX || n > MAX_BUDGET_UGX) return 'INVALID';
  return n;
}

/** One line for a person: "12 cartons (600 pieces)", "40 pieces", "3 cartons (carton size to confirm)". */
export function describeLineCount(line: Pick<BulkQuoteLine, 'unitKind' | 'unitCount' | 'quantity'>): string {
  const n = (v: number) => v.toLocaleString('en-US');
  if (line.unitCount === null) return `${n(line.quantity ?? 0)} ${line.quantity === 1 ? 'piece' : 'pieces'}`;
  if (line.unitKind === 'piece') return `${n(line.unitCount)} ${line.unitCount === 1 ? 'piece' : 'pieces'}`;
  const cartons = `${n(line.unitCount)} ${line.unitCount === 1 ? 'carton' : 'cartons'}`;
  return line.quantity === null ? `${cartons} (carton size to confirm)` : `${cartons} (${n(line.quantity)} pieces)`;
}

/** The legacy one-line summary columns, kept true for any older reader. */
export function legacySummary(lines: BulkQuoteLine[]): { productName: string; quantity: string } {
  if (lines.length === 0) return { productName: 'Bulk budget: the team builds the list', quantity: '0' };
  const first = lines[0]?.productName ?? 'Bulk list';
  const rest = lines.length - 1;
  const name = rest > 0 ? `Bulk list: ${first} and ${rest} more` : `Bulk list: ${first}`;
  const totals = totalsOf(lines);
  const quantity = totals.totalCartons > 0 ? `${totals.totalCartons} cartons, ${totals.totalUnits} pieces` : String(totals.totalUnits);
  return { productName: name.slice(0, 255), quantity: quantity.slice(0, 50) };
}

/* ------------------------------------------------------------------------ */
/* Reference                                                                  */
/* ------------------------------------------------------------------------ */

/** No 0/O, 1/I/L: a reference is read aloud over the phone. */
export const REFERENCE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const REFERENCE_PATTERN = new RegExp(`^BQ-[${REFERENCE_ALPHABET}]{6}$`);

/** `randomIndex(n)` returns an integer in [0, n). Injected so the domain stays pure. */
export function makeBulkReference(randomIndex: (n: number) => number): string {
  let body = '';
  for (let i = 0; i < 6; i++) body += REFERENCE_ALPHABET[randomIndex(REFERENCE_ALPHABET.length)];
  return `BQ-${body}`;
}

/** Accepts what a buyer types ("bq 7k3m9p", "BQ-7K3M9P") and returns the canonical form, or null. */
export function normaliseBulkReference(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const compact = raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!compact.startsWith('BQ') || compact.length !== 8) return null;
  const candidate = `BQ-${compact.slice(2)}`;
  return REFERENCE_PATTERN.test(candidate) ? candidate : null;
}

/* ------------------------------------------------------------------------ */
/* Status                                                                     */
/* ------------------------------------------------------------------------ */

const TRANSITIONS: Record<QuoteRequestStatus, readonly QuoteRequestStatus[]> = {
  new: ['quoted', 'lost'],
  quoted: ['won', 'lost', 'expired'],
  won: [],
  lost: [],
  expired: [],
};

export function isQuoteRequestStatus(value: unknown): value is QuoteRequestStatus {
  return typeof value === 'string' && (QUOTE_REQUEST_STATUSES as readonly string[]).includes(value);
}

export function canTransitionQuoteRequest(from: string, to: QuoteRequestStatus): boolean {
  if (!isQuoteRequestStatus(from)) return false;
  return TRANSITIONS[from].includes(to);
}

export function nextQuoteRequestStatuses(from: string): readonly QuoteRequestStatus[] {
  return isQuoteRequestStatus(from) ? TRANSITIONS[from] : [];
}

/** What a buyer is told about their request. Plain sentences, no system words. */
export function buyerStatusCopy(status: string): { label: string; detail: string } {
  switch (status) {
    case 'quoted':
      return { label: 'Quote sent', detail: 'Our sales team has sent you the final total and delivery date. Call us if you have not received it.' };
    case 'won':
      return { label: 'Confirmed', detail: 'You confirmed this order with our sales team.' };
    case 'lost':
      return { label: 'Closed', detail: 'This request is closed. Send a new one any time.' };
    case 'expired':
      return { label: 'Quote expired', detail: 'The price we gave has expired. Ask us for an updated quote.' };
    case 'new':
    default:
      return { label: 'Received', detail: 'We have your request. Our sales team will call you to confirm the delivery date and delivery cost.' };
  }
}

/* ------------------------------------------------------------------------ */
/* Idempotency                                                                */
/* ------------------------------------------------------------------------ */

const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,80}$/;

export function isValidIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && IDEMPOTENCY_KEY.test(value);
}

/**
 * The canonical text a submission is fingerprinted from: who (phone) and what
 * (products and counts, order-independent, and the budget). Hashing happens outside the
 * domain. Same key + same fingerprint = a retry; same key + different = conflict.
 */
export function fingerprintSource(phone: string, lines: BulkLineInput[], budgetUgx: number | null = null): string {
  const body = [...lines]
    .map((line) => `${line.productId.toLowerCase()}:${line.count}`)
    .sort()
    .join(',');
  return budgetUgx === null ? `${phone}|${body}` : `${phone}|${body}|budget:${budgetUgx}`;
}

/* ------------------------------------------------------------------------ */
/* Needed-by date                                                             */
/* ------------------------------------------------------------------------ */

/**
 * `YYYY-MM-DD`, a real calendar date, not before `today` and within a year of it.
 * Returns the canonical string, null for "not given", or 'INVALID'.
 */
export function parseNeededBy(raw: unknown, today: Date): string | null | 'INVALID' {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return 'INVALID';
  const value = raw.trim();
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return 'INVALID';
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (date.getTime() < start) return 'INVALID';
  if (date.getTime() > start + 366 * 24 * 60 * 60 * 1000) return 'INVALID';
  return value;
}
