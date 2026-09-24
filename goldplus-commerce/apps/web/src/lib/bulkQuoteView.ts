import { postJson } from './api';

/**
 * What the API returns about a buyer's own bulk request (POST /quotes/lookup,
 * and the submit response). Buyer-safe by construction on the API side: no
 * email, no notes, nothing internal.
 */
export interface BulkQuoteBuyerView {
  reference: string;
  status: string;
  statusLabel: string;
  statusDetail: string;
  createdAt: string;
  businessName: string | null;
  deliveryDistrict: string | null;
  neededBy: string | null;
  lines: Array<{
    lineNo: number;
    productCode: string | null;
    productName: string;
    quantity: number;
    unitPriceUgx: number | null;
    lineTotalUgx: number | null;
    availability: string;
  }>;
  totals: { lineCount: number; totalUnits: number; estimatedTotalUgx: number; pricedLineCount: number };
}

export type BulkLookupResult =
  | { ok: true; request: BulkQuoteBuyerView }
  | { ok: false; message: string; unreachable: boolean };

export async function lookupBulkQuote(reference: string, phone: string): Promise<BulkLookupResult> {
  const result = await postJson('/quotes/lookup', { reference, phone });
  if (result.ok) {
    const request = result.data as BulkQuoteBuyerView | undefined;
    if (request && typeof request.reference === 'string' && Array.isArray(request.lines)) return { ok: true, request };
    return { ok: false, message: 'We could not read that request just now. Please try again.', unreachable: true };
  }
  return result.code === 'NETWORK'
    ? { ok: false, message: 'We cannot reach our sales system right now. Please try again shortly.', unreachable: true }
    : { ok: false, message: result.message, unreachable: false };
}

export function availabilityLabel(value: string): string {
  switch (value) {
    case 'in_stock':
      return 'In stock when you asked';
    case 'out_of_stock':
      return 'Out of stock when you asked';
    case 'pre_order':
      return 'Pre-order';
    default:
      return 'Stock to confirm';
  }
}
