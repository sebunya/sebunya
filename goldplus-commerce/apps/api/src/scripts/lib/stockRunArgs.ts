/**
 * Env parsing for the stock / battery-import scripts. Pure, so a typo is
 * rejected by a tested rule instead of falling through to another import.
 */
export type BatteryImportStage = 'BATTERY_CATALOGUE' | 'PRICE_UPDATE' | 'STOCK_COUNT';

const STAGES: Record<string, BatteryImportStage> = { catalogue: 'BATTERY_CATALOGUE', price: 'PRICE_UPDATE', stock: 'STOCK_COUNT' };

/** STAGE=catalogue|price|stock (default catalogue). Anything else throws: a typo must never run a price import. */
export function parseBatteryImportStage(raw: string | undefined): BatteryImportStage {
  const stage = (raw ?? 'catalogue').trim();
  const kind = STAGES[stage];
  if (!kind) throw new Error(`STAGE must be one of ${Object.keys(STAGES).join(', ')} (got "${stage}").`);
  return kind;
}

/** QUANTITY as a whole number from 0 to 100000 (default 200). Anything else throws. */
export function parseStockQuantity(raw: string | undefined, fallback = 200): number {
  const text = (raw ?? '').trim();
  const quantity = text === '' ? fallback : Number(text);
  if (!Number.isInteger(quantity) || quantity < 0 || quantity > 100_000) throw new Error(`QUANTITY must be a whole number from 0 to 100000 (got "${raw}").`);
  return quantity;
}

/** The audit / count reason: the operator's REASON when given, else one that states the quantity actually used. */
export function stockReason(quantity: number, reason: string | undefined): string {
  const given = (reason ?? '').trim();
  return given || `Stock set to ${quantity} units per product`;
}
