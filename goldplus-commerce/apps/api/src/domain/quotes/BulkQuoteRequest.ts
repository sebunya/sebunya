/**
 * A bulk quote request: one buyer, many products, a quantity each.
 *
 * Pure domain (no framework, no database). The client names products by id and
 * says how many; everything else on a line (name, code, list price, whether it
 * is in stock) is a SNAPSHOT the server takes from the public catalogue at the
 * moment of the request. A price the client sends is never read.
 *
 * See docs/bulk-buying/DESIGN.md.
 */

export type QuoteRequestStatus = 'new' | 'quoted' | 'won' | 'lost' | 'expired';
export const QUOTE_REQUEST_STATUSES: readonly QuoteRequestStatus[] = ['new', 'quoted', 'won', 'lost', 'expired'];

export type BulkBuyerType = 'retail' | 'wholesale' | 'corporate' | 'dealer';
export const BULK_BUYER_TYPES: readonly BulkBuyerType[] = ['retail', 'wholesale', 'corporate', 'dealer'];

export type LineAvailability = 'in_stock' | 'out_of_stock' | 'pre_order' | 'unknown';

/** Enough for the whole catalogue (192 products today) with room to grow. */
export const MAX_BULK_LINES = 200;
/** Per product. Large enough for any real reseller order, small enough to stop nonsense. */
export const MAX_BULK_LINE_QUANTITY = 50_000;
/** The basket's own per-product ceiling (MutateCartUseCase.MAX_LINE_QUANTITY). */
export const CART_LINE_QUANTITY_CAP = 99;

export interface BulkLineInput {
  productId: string;
  quantity: number;
}

/** What the public catalogue says about one product, read on the server. */
export interface CatalogueEntry {
  productId: string;
  name: string;
  /** SKU first, else model number; null when the catalogue has neither. */
  code: string | null;
  /** Public list price in UGX; null when the product has no listed price. */
  unitPriceUgx: number | null;
  availability: LineAvailability;
}

export interface BulkQuoteLine {
  lineNo: number;
  productId: string | null;
  productCode: string | null;
  productName: string;
  quantity: number;
  unitPriceUgx: number | null;
  lineTotalUgx: number | null;
  availability: LineAvailability;
}

export interface BulkQuoteTotals {
  lineCount: number;
  totalUnits: number;
  /** Sum of priced lines only, at public list price. An estimate, never a bill. */
  estimatedTotalUgx: number;
  pricedLineCount: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LineValidation =
  | { ok: true; lines: BulkLineInput[] }
  | { ok: false; code: 'NO_LINES' | 'TOO_MANY_LINES' | 'BAD_LINE'; message: string };

/**
 * Checks the shape of what the client sent and merges repeats of one product.
 * Order is the buyer's order (first appearance). Nothing here trusts a type.
 */
export function validateBulkLines(raw: unknown): LineValidation {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, code: 'NO_LINES', message: 'Add at least one product with a quantity.' };
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
    const quantity = (item as { quantity?: unknown })?.quantity;
    if (!UUID.test(productId)) {
      return { ok: false, code: 'BAD_LINE', message: 'One of the products could not be read. Reload the page and try again.' };
    }
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_BULK_LINE_QUANTITY) {
      return { ok: false, code: 'BAD_LINE', message: `Each quantity must be a whole number from 1 to ${MAX_BULK_LINE_QUANTITY.toLocaleString('en-US')}.` };
    }
    merged.set(productId, Math.min(MAX_BULK_LINE_QUANTITY, (merged.get(productId) ?? 0) + quantity));
  }
  if (merged.size > MAX_BULK_LINES) {
    return { ok: false, code: 'TOO_MANY_LINES', message: `A bulk request can hold up to ${MAX_BULK_LINES} products.` };
  }
  return { ok: true, lines: [...merged.entries()].map(([productId, quantity]) => ({ productId, quantity })) };
}

export type SnapshotResult =
  | { ok: true; lines: BulkQuoteLine[]; totals: BulkQuoteTotals }
  | { ok: false; code: 'PRODUCTS_UNAVAILABLE'; productIds: string[] };

/**
 * Turns validated lines into snapshot lines from the server's catalogue read.
 * A product missing from the read is not on sale: the whole request is refused
 * with the offending ids, so the buyer is told rather than quietly short-changed.
 */
export function snapshotBulkLines(lines: BulkLineInput[], catalogue: CatalogueEntry[]): SnapshotResult {
  const byId = new Map(catalogue.map((entry) => [entry.productId.toLowerCase(), entry]));
  const missing = lines.filter((line) => !byId.has(line.productId)).map((line) => line.productId);
  if (missing.length > 0) return { ok: false, code: 'PRODUCTS_UNAVAILABLE', productIds: missing };

  const out: BulkQuoteLine[] = lines.map((line, index) => {
    const entry = byId.get(line.productId) as CatalogueEntry;
    const price = typeof entry.unitPriceUgx === 'number' && Number.isFinite(entry.unitPriceUgx) && entry.unitPriceUgx > 0
      ? Math.round(entry.unitPriceUgx)
      : null;
    return {
      lineNo: index + 1,
      productId: entry.productId,
      productCode: entry.code ? entry.code.slice(0, 120) : null,
      productName: entry.name.slice(0, 255),
      quantity: line.quantity,
      unitPriceUgx: price,
      lineTotalUgx: price === null ? null : price * line.quantity,
      availability: entry.availability,
    };
  });
  return { ok: true, lines: out, totals: totalsOf(out) };
}

export function totalsOf(lines: Array<Pick<BulkQuoteLine, 'quantity' | 'lineTotalUgx'>>): BulkQuoteTotals {
  let totalUnits = 0;
  let estimatedTotalUgx = 0;
  let pricedLineCount = 0;
  for (const line of lines) {
    totalUnits += line.quantity;
    if (typeof line.lineTotalUgx === 'number') {
      estimatedTotalUgx += line.lineTotalUgx;
      pricedLineCount += 1;
    }
  }
  return { lineCount: lines.length, totalUnits, estimatedTotalUgx, pricedLineCount };
}

/** The legacy one-line summary columns, kept true for any older reader. */
export function legacySummary(lines: BulkQuoteLine[]): { productName: string; quantity: string } {
  const first = lines[0]?.productName ?? 'Bulk list';
  const rest = lines.length - 1;
  const name = rest > 0 ? `Bulk list: ${first} and ${rest} more` : `Bulk list: ${first}`;
  return { productName: name.slice(0, 255), quantity: String(totalsOf(lines).totalUnits) };
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
      return { label: 'Quote sent', detail: 'Our sales team has sent you a price. Call us if you have not received it.' };
    case 'won':
      return { label: 'Confirmed', detail: 'You confirmed this order with our sales team.' };
    case 'lost':
      return { label: 'Closed', detail: 'This request is closed. Send a new one any time.' };
    case 'expired':
      return { label: 'Quote expired', detail: 'The price we gave has expired. Ask us for an updated quote.' };
    case 'new':
    default:
      return { label: 'Received', detail: 'We have your list. Our sales team will call you to confirm it and give you a price.' };
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
 * (products and quantities, order-independent). Hashing happens outside the
 * domain. Same key + same fingerprint = a retry; same key + different = conflict.
 */
export function fingerprintSource(phone: string, lines: BulkLineInput[]): string {
  const body = [...lines]
    .map((line) => `${line.productId.toLowerCase()}:${line.quantity}`)
    .sort()
    .join(',');
  return `${phone}|${body}`;
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
