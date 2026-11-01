/**
 * The bulk builder's list, as pure functions (docs/bulk-buying/DESIGN.md §12).
 *
 * Bundled for the browser by /bulk, so nothing here may import a server
 * module. A line is a product and a COUNT in that product's bulk unit: cartons,
 * or pieces for flash drives and memory cards. The list also keeps an optional
 * budget. Prices are never stored: the page reads them from what it rendered
 * (only after the buyer proved their phone), and the server re-reads them.
 * Bulk is supplied to order, so nothing here knows about website stock.
 */

/** Mirrors the API (domain/quotes/BulkQuoteRequest.ts). */
export const MAX_BULK_LINES = 200;
export const SELF_SERVE_MAX_CARTONS = 500;
export const MAX_CARTONS_PER_LINE = 10_000;
export const MAX_PIECES_PER_LINE = 50_000;
export const MIN_BUDGET_UGX = 10_000;
export const MAX_BUDGET_UGX = 10_000_000_000;

/** v2: counts in cartons or pieces. A v1 list held pieces and cannot be read as cartons, so it starts again. */
export const BULK_STORAGE_KEY = 'gp_bulk_list_v2';

export type BulkUnit = 'carton' | 'piece';

export interface BulkLine {
  productId: string;
  /** Cartons, or pieces for a piece product. */
  count: number;
  /** What the buyer saw, kept for a product that leaves the catalogue. */
  name: string;
  code: string | null;
}

export interface BulkListState {
  v: 2;
  lines: BulkLine[];
  budgetUgx: number | null;
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
  bulkUnit: BulkUnit;
  /** Pieces in a carton; null when not entered yet. */
  unitsPerCarton: number | null;
  /** Bulk price per piece; null when locked or not set. */
  bulkPriceUgx: number | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function emptyState(): BulkListState {
  return { v: 2, lines: [], budgetUgx: null, pending: null };
}

export function maxCountFor(unit: BulkUnit): number {
  return unit === 'piece' ? MAX_PIECES_PER_LINE : MAX_CARTONS_PER_LINE;
}

/** A whole number from 1 to the unit's bound, or null for anything else. */
export function clampCount(value: unknown, unit: BulkUnit = 'carton'): number | null {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim().replace(/[,\s_]/g, ''));
  if (!Number.isFinite(n)) return null;
  const whole = Math.trunc(n);
  if (whole < 1) return null;
  return Math.min(maxCountFor(unit), whole);
}

/** A budget in whole shillings within bounds, or null. */
export function parseBudgetInput(value: unknown): number | null {
  const digits = String(value ?? '').replace(/ugx|shs?|[\s,_]/gi, '');
  if (!/^\d{1,11}$/.test(digits)) return null;
  const n = Number(digits);
  return n >= MIN_BUDGET_UGX && n <= MAX_BUDGET_UGX ? n : null;
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
  const obj = data as { v?: unknown; lines?: unknown; pending?: unknown; budgetUgx?: unknown };
  if (!obj || obj.v !== 2 || !Array.isArray(obj.lines)) return emptyState();
  const seen = new Set<string>();
  const lines: BulkLine[] = [];
  for (const item of obj.lines) {
    const line = item as Partial<BulkLine>;
    const id = typeof line?.productId === 'string' ? line.productId.toLowerCase() : '';
    // The unit is not stored; the widest bound applies until the page knows the product.
    const count = clampCount(line?.count, 'piece');
    if (!UUID.test(id) || count === null || seen.has(id)) continue;
    seen.add(id);
    lines.push({
      productId: id,
      count,
      name: typeof line.name === 'string' ? line.name.slice(0, 200) : '',
      code: typeof line.code === 'string' && line.code ? line.code.slice(0, 120) : null,
    });
    if (lines.length >= MAX_BULK_LINES) break;
  }
  const p = obj.pending as { key?: unknown; fingerprint?: unknown } | null;
  const pending = p && typeof p.key === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(p.key) && typeof p.fingerprint === 'string'
    ? { key: p.key, fingerprint: p.fingerprint }
    : null;
  return { v: 2, lines, budgetUgx: parseBudgetInput(obj.budgetUgx), pending };
}

export function serializeState(state: BulkListState): string {
  return JSON.stringify(state);
}

/** Sets a line's count (adding the line if new); 0 or less removes it. */
export function setLine(state: BulkListState, item: Pick<CatalogueItem, 'productId' | 'name' | 'code' | 'bulkUnit'>, count: number): BulkListState {
  const id = item.productId.toLowerCase();
  const others = state.lines.filter((line) => line.productId !== id);
  const n = clampCount(count, item.bulkUnit);
  if (n === null) return { ...state, lines: others };
  const existingIndex = state.lines.findIndex((line) => line.productId === id);
  const next: BulkLine = { productId: id, count: n, name: item.name, code: item.code };
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

export function countOf(state: BulkListState, productId: string): number {
  return state.lines.find((line) => line.productId === productId.toLowerCase())?.count ?? 0;
}

export function setBudget(state: BulkListState, value: unknown): BulkListState {
  return { ...state, budgetUgx: parseBudgetInput(value) };
}

/** Pieces for a count; null when a carton's size is not known. */
export function piecesOf(item: Pick<CatalogueItem, 'bulkUnit' | 'unitsPerCarton'>, count: number): number | null {
  if (item.bulkUnit === 'piece') return count;
  return item.unitsPerCarton && item.unitsPerCarton > 0 ? count * item.unitsPerCarton : null;
}

/** "12 cartons (600 pieces)", "40 pieces", "3 cartons (size to confirm)". */
export function countLabel(item: Pick<CatalogueItem, 'bulkUnit' | 'unitsPerCarton'>, count: number): string {
  const n = (v: number) => v.toLocaleString('en-US');
  if (item.bulkUnit === 'piece') return `${n(count)} ${count === 1 ? 'piece' : 'pieces'}`;
  const pieces = piecesOf(item, count);
  const cartons = `${n(count)} ${count === 1 ? 'carton' : 'cartons'}`;
  return pieces === null ? `${cartons} (size to confirm)` : `${cartons} (${n(pieces)} pieces)`;
}

/** What one unit is: "Carton of 50 pieces", "Carton, size to confirm", "Sold by the piece". */
export function unitLabel(item: Pick<CatalogueItem, 'bulkUnit' | 'unitsPerCarton'>): string {
  if (item.bulkUnit === 'piece') return 'Sold by the piece';
  return item.unitsPerCarton ? `Carton of ${item.unitsPerCarton.toLocaleString('en-US')} pieces` : 'Carton, size to confirm';
}

export interface BulkEstimate {
  lineCount: number;
  totalCartons: number;
  /** Pieces on lines where the count is known. */
  totalPieces: number;
  /** Lines in cartons of a size not yet entered. */
  piecesUnknownLineCount: number;
  /** At the bulk price, on lines with a price and a known number of pieces. */
  estimatedTotalUgx: number;
  /** Lines the team prices: no bulk price, or no carton size. */
  unpricedLineCount: number;
  /** Lines whose product is no longer in the catalogue. */
  unavailableLineCount: number;
  /** Lines over 500 cartons: taken, the team confirms supply. */
  aboveSelfServeCount: number;
}

export function estimate(state: BulkListState, catalogue: ReadonlyMap<string, CatalogueItem>): BulkEstimate {
  const out: BulkEstimate = {
    lineCount: state.lines.length,
    totalCartons: 0,
    totalPieces: 0,
    piecesUnknownLineCount: 0,
    estimatedTotalUgx: 0,
    unpricedLineCount: 0,
    unavailableLineCount: 0,
    aboveSelfServeCount: 0,
  };
  for (const line of state.lines) {
    const item = catalogue.get(line.productId);
    if (!item) {
      out.unavailableLineCount += 1;
      continue;
    }
    if (item.bulkUnit === 'carton') {
      out.totalCartons += line.count;
      if (line.count > SELF_SERVE_MAX_CARTONS) out.aboveSelfServeCount += 1;
    }
    const pieces = piecesOf(item, line.count);
    if (pieces === null) out.piecesUnknownLineCount += 1;
    else out.totalPieces += pieces;
    if (pieces !== null && typeof item.bulkPriceUgx === 'number' && item.bulkPriceUgx > 0) out.estimatedTotalUgx += item.bulkPriceUgx * pieces;
    else out.unpricedLineCount += 1;
  }
  return out;
}

export type BudgetStatus =
  | { kind: 'none' }
  /** A budget, but no prices to measure it with (not unlocked). */
  | { kind: 'unmeasured'; budgetUgx: number }
  | { kind: 'within' | 'over'; budgetUgx: number; usedUgx: number; remainingUgx: number };

export function budgetStatus(budgetUgx: number | null, est: BulkEstimate, pricesUnlocked: boolean): BudgetStatus {
  if (budgetUgx === null) return { kind: 'none' };
  if (!pricesUnlocked) return { kind: 'unmeasured', budgetUgx };
  const remainingUgx = budgetUgx - est.estimatedTotalUgx;
  return { kind: remainingUgx < 0 ? 'over' : 'within', budgetUgx, usedUgx: est.estimatedTotalUgx, remainingUgx };
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
  count: number;
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
    /^(.+?)\s*[,;\t:=*|]\s*(\S+?)\s*(?:pcs?|pieces?|units?|ctns?|cartons?|boxe?s?)?\.?$/i,
    // CODE x QTY  (x must follow a space, so a code ending in X is safe)
    /^(.+?)\s+x\s*(\d[\d,]*)\s*(?:pcs?|pieces?|units?|ctns?|cartons?|boxe?s?)?\.?$/i,
    // QTY x CODE / QTY CODE
    /^(\d[\d,]*)\s*(?:pcs?|pieces?|units?|ctns?|cartons?|boxe?s?)?\s*(?:x\s+|x(?=[A-Za-z])|\s+)(.+)$/i,
    // CODE QTY
    /^(.+?)\s+(\d[\d,]*)\s*(?:pcs?|pieces?|units?|ctns?|cartons?|boxe?s?)?\.?$/i,
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
 * name. The number is cartons, or pieces for a piece product. Every line that
 * does not match is returned with a reason; none is dropped. Repeats are summed.
 */
export function parsePaste(input: string, index: CodeIndex, units: ReadonlyMap<string, BulkUnit> = new Map()): { matches: PasteMatch[]; misses: PasteMiss[] } {
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
    const unit = units.get(id) ?? 'carton';
    const count = /^\d[\d,]*$/.test(parts.quantity) ? clampCount(parts.quantity, unit) : null;
    if (count === null || Number(parts.quantity.replace(/,/g, '')) > maxCountFor(unit)) {
      misses.push({ source, reason: 'BAD_QUANTITY' });
      continue;
    }
    const prior = merged.get(id);
    merged.set(id, {
      productId: id,
      count: Math.min(maxCountFor(unit), (prior?.count ?? 0) + count),
      source: prior ? `${prior.source}; ${source}` : source,
    });
  }
  return { matches: [...merged.values()], misses };
}

export function pasteMissMessage(reason: PasteMiss['reason']): string {
  switch (reason) {
    case 'NO_QUANTITY':
      return 'No number of cartons. Write it like GP-C08, 5';
    case 'BAD_QUANTITY':
      return `Must be a whole number of cartons from 1 to ${MAX_CARTONS_PER_LINE.toLocaleString('en-US')} (pieces up to ${MAX_PIECES_PER_LINE.toLocaleString('en-US')} for flash drives and memory cards)`;
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

/** What a submission is: the phone, the lines and the budget. A change means a new submission. */
export function submissionFingerprint(phone: string, lines: Array<Pick<BulkLine, 'productId' | 'count'>>, budgetUgx: number | null = null): string {
  const body = lines.map((line) => `${line.productId}:${line.count}`).sort().join(',');
  return `${phone.replace(/\s+/g, '')}|${body}|${budgetUgx ?? ''}`;
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
