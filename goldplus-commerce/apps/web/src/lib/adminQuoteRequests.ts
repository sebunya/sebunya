/**
 * A quote request as the admin API returns it (GET /admin/quote-requests):
 * a legacy single-product form row (source 'form', no lines) or a bulk list.
 */
export interface AdminQuoteLine {
  lineNo: number;
  productId: string | null;
  productCode: string | null;
  productName: string;
  quantity: number;
  unitPriceUgx: number | null;
  lineTotalUgx: number | null;
  availability: string;
}

export interface AdminQuoteRequest {
  id: string;
  reference: string | null;
  source: 'form' | 'bulk_builder';
  status: string;
  customerName: string;
  businessName: string | null;
  phone: string;
  email: string;
  buyerType: string | null;
  deliveryDistrict: string | null;
  neededBy: string | null;
  notes: string;
  productName: string;
  quantity: string;
  lines: AdminQuoteLine[];
  totals: { lineCount: number; totalUnits: number; estimatedTotalUgx: number; pricedLineCount: number };
  createdAt: string;
  updatedAt: string | null;
}

export const QUOTE_STATUS_LABEL: Record<string, string> = {
  new: 'New',
  quoted: 'Quoted',
  won: 'Won',
  lost: 'Lost',
  expired: 'Expired',
};

export const QUOTE_STATUS_CLASS: Record<string, string> = {
  new: 'bg-orange-50 text-orange-800 border-orange-200',
  quoted: 'bg-blue-50 text-blue-800 border-blue-200',
  won: 'bg-green-50 text-green-800 border-green-200',
  lost: 'bg-gray-50 text-gray-700 border-gray-200',
  expired: 'bg-gray-50 text-gray-700 border-gray-200',
};

/** Mirrors the domain's transitions (domain/quotes/BulkQuoteRequest.ts); the API is the authority. */
export const NEXT_QUOTE_STATUSES: Record<string, string[]> = {
  new: ['quoted', 'lost'],
  quoted: ['won', 'lost', 'expired'],
  won: [],
  lost: [],
  expired: [],
};

export const BUYER_TYPE_LABEL: Record<string, string> = {
  retail: 'Personal or other',
  wholesale: 'Shop or reseller',
  corporate: 'Business, school or office',
  dealer: 'Existing dealer',
};

export function kampalaDateTime(iso: string | null | undefined): string {
  const t = iso ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t)
    ? new Date(t).toLocaleString('en-GB', { timeZone: 'Africa/Kampala', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';
}

/** Grouped digits for counts ("1,200"); not a timestamp, so no time zone applies. */
export function formatCount(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
}
