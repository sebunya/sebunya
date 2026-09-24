/**
 * The bulk order builder's list, as pure functions (docs/bulk-buying/DESIGN.md).
 *
 * Bundled for the browser by /bulk, so nothing here may import a server
 * module. The list stores product ids and quantities (plus the name and code
 * the buyer saw, so a product that later leaves the catalogue can still be
 * named and removed). Prices are never stored: the page reads them from the
 * catalogue it rendered, and the server re-reads them on a quote.
 */

/** Mirrors the API (domain/quotes/BulkQuoteRequest.ts). */
export const MAX_BULK_LINES = 200;
export const MAX_BULK_LINE_QUANTITY = 50_000;
/** The basket's per-product ceiling. */
export const CART_LINE_QUANTITY_CAP = 99;
/** The basket's distinct-product ceiling. */
export const CART_MAX_DISTINCT_LINES = 50;

export const BULK_STORAGE_KEY = 'gp_bulk_list_v1';

export interface BulkLine {
  productId: string;
  quantity: number;
  /** What the buyer saw, kept for a product that leaves the catalogue. */
  name: string;
  code: string | null;
}

export interface BulkListState {
  v: 1;
  lines: BulkLine[];
  /** The current submission's idempotency key and what it was minted for. */
  pending: { key: string; fingerprint: string } | null;
}

export interface CatalogueItem {
  productId: string;
  name: string;
  /** SKU, else model number. */
  code: string | null;
  sku: string | null;
  modelNumber: string | null;
  unitPriceUgx: number | null;
  inStock: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function emptyState(): BulkListState {
  return { v: 1, lines: [], pending: null };
}

/** A whole number within the per-line bounds, or null for anything else. */
export function clampQuantity(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim().replace(/[,\s_]/g, ''));
  if (!Number.isFinite(n)) return null;
  const whole = Math.trunc(n);
  if (whole < 1) return null;
  return Math.min(MAX_BULK_LINE_QUANTITY, whole);
}

/** Reads what localStorage held; anything malformed becomes an empty list, never an error. */
export function parseStoredState(raw: string | null | undefined): BulkListState {
  if (!raw) return emptyState();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return emptyState();
  }
  const obj = data as { v?: unknown; lines?: unknown; pending?: unknown };
  if (!obj || obj.v !== 1 || !Array.isArray(obj.lines)) return emptyState();
  const seen = new Set<string>();
  const lines: BulkLine[] = [];
  for (const item of obj.lines) {
    const line = item as Partial<BulkLine>;
    const id = typeof line?.productId === 'string' ? line.productId.toLowerCase() : '';
    const qty = clampQuantity(line?.quantity);
    if (!UUID.test(id) || qty === null || seen.has(id)) continue;
    seen.add(id);
    lines.push({
      productId: id,
      quantity: qty,
      name: typeof line.name === 'string' ? line.name.slice(0, 200) : '',
      code: typeof line.code === 'string' && line.code ? line.code.slice(0, 120) : null,
    });
    if (lines.length >= MAX_BULK_LINES) break;
  }
  const p = obj.pending as { key?: unknown; fingerprint?: unknown } | null;
  const pending = p && typeof p.key === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(p.key) && typeof p.fingerprint === 'string'
    ? { key: p.key, fingerprint: p.fingerprint }
    : null;
  return { v: 1, lines, pending };
}

export function serializeState(state: BulkListState): string {
  return JSON.stringify(state);
}

/** Sets a line's quantity (adding the line if new); 0 or less removes it. */
export function setLine(state: BulkListState, item: Pick<BulkLine, 'productId' | 'name' | 'code'>, quantity: number): BulkListState {
  const id = item.productId.toLowerCase();
  const others = state.lines.filter((line) => line.productId !== id);
  const qty = clampQuantity(quantity);
  if (qty === null) return { ...state, lines: others };
  const existingIndex = state.lines.findIndex((line) => line.productId === id);
  const next: BulkLine = { productId: id, quantity: qty, name: item.name, code: item.code };
  if (existingIndex >= 0) {
    const lines = [...state.lines];
    lines[existingIndex] = next;
    return { ...state, lines };
  }
  if (state.lines.length >= MAX_BULK_LINES) return state;
  return { ...state, lines: [...others, next] };
}

export function removeLine(state: BulkListState, productId: string): BulkListState {
  const id = productId.toLowerCase();
  return { ...state, lines: state.lines.filter((line) => line.productId !== id) };
}

export function quantityOf(state: BulkListState, productId: string): number {
  return state.lines.find((line) => line.productId === productId.toLowerCase())?.quantity ?? 0;
}

export interface BulkEstimate {
  lineCount: number;
  totalUnits: number;
  /** At public list price, priced and still-listed lines only. */
  estimatedTotalUgx: number;
  /** Lines with no listed price: the team prices them. */
  unpricedLineCount: number;
  /** Lines whose product is no longer in the catalogue. */
  unavailableLineCount: number;
}

export function estimate(state: BulkListState, catalogue: ReadonlyMap<string, CatalogueItem>): BulkEstimate {
  let totalUnits = 0;
  let estimatedTotalUgx = 0;
  let unpricedLineCount = 0;
  let unavailableLineCount = 0;
  for (const line of state.lines) {
    totalUnits += line.quantity;
    const item = catalogue.get(line.productId);
    if (!item) {
      unavailableLineCount += 1;
      continue;
    }
    if (typeof item.unitPriceUgx === 'number' && item.unitPriceUgx > 0) estimatedTotalUgx += item.unitPriceUgx * line.quantity;
    else unpricedLineCount += 1;
  }
  return { lineCount: state.lines.length, totalUnits, estimatedTotalUgx, unpricedLineCount, unavailableLineCount };
}

/** Lines the basket can take (1 to 99) and those it cannot. Unlisted products go to neither. */
export function splitForCart(state: BulkListState, catalogue: ReadonlyMap<string, CatalogueItem>): { cartable: BulkLine[]; overCap: BulkLine[] } {
  const cartable: BulkLine[] = [];
  const overCap: BulkLine[] = [];
  for (const line of state.lines) {
    if (!catalogue.has(line.productId)) continue;
    (line.quantity <= CART_LINE_QUANTITY_CAP ? cartable : overCap).push(line);
  }
  return { cartable, overCap };
}

/* ------------------------------------------------------------------------ */
/* Paste                                                                      */
/* ------------------------------------------------------------------------ */

/** Case, spaces, dashes, dots and slashes do not distinguish codes: "gp c08" is "GP-C08". */
export function normaliseCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export interface CodeIndex {
  /** Normalised code or name → product ids (more than one = ambiguous). */
  byKey: Map<string, string[]>;
}

export function buildCodeIndex(items: Iterable<CatalogueItem>): CodeIndex {
  const byKey = new Map<string, string[]>();
  const add = (key: string, id: string) => {
    if (!key) return;
    const ids = byKey.get(key) ?? [];
    if (!ids.includes(id)) ids.push(id);
    byKey.set(key, ids);
  };
  for (const item of items) {
    if (item.sku) add(normaliseCode(item.sku), item.productId);
    if (item.modelNumber) add(normaliseCode(item.modelNumber), item.productId);
    add(`NAME:${normaliseCode(item.name)}`, item.productId);
  }
  return { byKey };
}

export interface PasteMatch {
  productId: string;
  quantity: number;
  source: string;
}

export interface PasteMiss {
  source: string;
  reason: 'NO_QUANTITY' | 'BAD_QUANTITY' | 'NOT_FOUND' | 'AMBIGUOUS';
}

/** Splits "CODE, 50", "CODE x50", "CODE 50", "CODE<tab>50", "50 x CODE" into its parts. */
export function splitPasteLine(line: string): { code: string; quantity: string } | null {
  const text = line.replace(/×/g, 'x').trim();
  if (!text) return null;
  const patterns: RegExp[] = [
    // CODE <sep> QTY  (comma, semicolon, tab, colon, equals, asterisk, pipe)
    /^(.+?)\s*[,;\t:=*|]\s*(\S+?)\s*(?:pcs?|pieces?|units?)?\.?$/i,
    // CODE x QTY  (x must follow a space, so a code ending in X is safe)
    /^(.+?)\s+x\s*(\d[\d,]*)\s*(?:pcs?|pieces?|units?)?\.?$/i,
    // QTY x CODE / QTY CODE
    /^(\d[\d,]*)\s*(?:pcs?|pieces?|units?)?\s*(?:x\s+|x(?=[A-Za-z])|\s+)(.+)$/i,
    // CODE QTY
    /^(.+?)\s+(\d[\d,]*)\s*(?:pcs?|pieces?|units?)?\.?$/i,
  ];
  for (let i = 0; i < patterns.length; i++) {
    const m = text.match(patterns[i]);
    if (!m) continue;
    if (i === 2) return { code: m[2].trim(), quantity: m[1] };
    return { code: m[1].trim(), quantity: m[2] };
  }
  return { code: text, quantity: '' };
}

/**
 * Matches pasted lines to products by code (SKU or model number), else by exact
 * name. Every line that does not match is returned with a reason; none is dropped.
 * Repeats of one product are summed.
 */
export function parsePaste(input: string, index: CodeIndex): { matches: PasteMatch[]; misses: PasteMiss[] } {
  const merged = new Map<string, PasteMatch>();
  const misses: PasteMiss[] = [];
  const rawLines = input.split(/\r?\n/).slice(0, MAX_BULK_LINES * 2);
  for (const raw of rawLines) {
    const source = raw.trim().slice(0, 200);
    if (!source) continue;
    const parts = splitPasteLine(source);
    if (!parts) continue;
    if (!parts.quantity) {
      misses.push({ source, reason: 'NO_QUANTITY' });
      continue;
    }
    const quantity = /^\d[\d,]*$/.test(parts.quantity) ? clampQuantity(parts.quantity) : null;
    if (quantity === null || Number(parts.quantity.replace(/,/g, '')) > MAX_BULK_LINE_QUANTITY) {
      misses.push({ source, reason: 'BAD_QUANTITY' });
      continue;
    }
    const key = normaliseCode(parts.code);
    const ids = index.byKey.get(key) ?? index.byKey.get(`NAME:${key}`) ?? [];
    if (ids.length === 0) {
      misses.push({ source, reason: 'NOT_FOUND' });
      continue;
    }
    if (ids.length > 1) {
      misses.push({ source, reason: 'AMBIGUOUS' });
      continue;
    }
    const id = ids[0];
    const prior = merged.get(id);
    merged.set(id, {
      productId: id,
      quantity: Math.min(MAX_BULK_LINE_QUANTITY, (prior?.quantity ?? 0) + quantity),
      source: prior ? `${prior.source}; ${source}` : source,
    });
  }
  return { matches: [...merged.values()], misses };
}

export function pasteMissMessage(reason: PasteMiss['reason']): string {
  switch (reason) {
    case 'NO_QUANTITY':
      return 'No quantity. Write it like GP-C08, 50';
    case 'BAD_QUANTITY':
      return `Quantity must be a whole number from 1 to ${MAX_BULK_LINE_QUANTITY.toLocaleString('en-US')}`;
    case 'AMBIGUOUS':
      return 'More than one product has this code. Use the list below instead';
    case 'NOT_FOUND':
    default:
      return 'No product with this code';
  }
}

/* ------------------------------------------------------------------------ */
/* Idempotency                                                                */
/* ------------------------------------------------------------------------ */

/** What a submission is: the phone and the lines. A change means a new submission. */
export function submissionFingerprint(phone: string, lines: Array<Pick<BulkLine, 'productId' | 'quantity'>>): string {
  const body = lines.map((line) => `${line.productId}:${line.quantity}`).sort().join(',');
  return `${phone.replace(/\s+/g, '')}|${body}`;
}

/**
 * Keeps the key while the submission is unchanged (so a retry after a dropped
 * connection is recognised as the same request), and mints a new one otherwise.
 */
export function idempotencyKeyFor(state: BulkListState, fingerprint: string, mint: () => string): { key: string; state: BulkListState } {
  if (state.pending && state.pending.fingerprint === fingerprint) return { key: state.pending.key, state };
  const key = mint();
  return { key, state: { ...state, pending: { key, fingerprint } } };
}
