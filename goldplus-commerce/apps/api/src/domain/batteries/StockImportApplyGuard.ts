/**
 * Apply-time guard for stock imports (owner decision 2026-09-24). Pure.
 *
 * A stock import is previewed, approved by a second person, then applied —
 * possibly days later. The preview's checks describe the stock AT PREVIEW:
 *  - STOCK_COUNT stores the system quantity it was judged against, but apply
 *    posted "set to the counted figure" against whatever stock was live then.
 *    Sales in between (consumeForOrder decrements stock without a ledger row)
 *    were silently undone: counted 8 against 4, two sold (stock 2), apply set
 *    8 — two phantom units, oversold to customers.
 *  - STOCK_RECEIPT checked "already applied" only at preview, so two sessions
 *    for one delivery, both previewed before either applied, both added stock.
 * The row now FAILS with a reason instead; the same stance as the manual
 * count's COUNT_STALE.
 */
export type StockImportApplyRefusal = { code: 'COUNT_STALE' | 'DUPLICATE_RECEIPT'; message: string };

export function stockCountApplyRefusal(input: { systemQuantityAtPreview: number | null | undefined; liveStock: number | null | undefined }): StockImportApplyRefusal | null {
  const previewed = input.systemQuantityAtPreview;
  const live = input.liveStock;
  if (previewed === null || previewed === undefined || live === null || live === undefined) return null;
  if (Number(previewed) === Number(live)) return null;
  return {
    code: 'COUNT_STALE',
    message: `Stock moved from ${previewed} to ${live} since this count was previewed (sales or receipts in between). Nothing was posted — re-count and import again.`,
  };
}

export function stockReceiptApplyRefusal(input: { alreadyApplied: boolean; quantity: number; reference: string | null | undefined }): StockImportApplyRefusal | null {
  if (!input.alreadyApplied) return null;
  return {
    code: 'DUPLICATE_RECEIPT',
    message: `A receipt of ${input.quantity} with reference "${input.reference ?? 'none'}" was applied after this import was previewed. Nothing was posted, to avoid counting one delivery twice.`,
  };
}
