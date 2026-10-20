/** What a phone-verified dealer sees: their own records only, matched on the phone's last nine digits. */
export interface DealerAccountView {
  application: { businessName: string; status: string; submittedAt: string } | null;
  quotes: Array<{
    reference: string | null;
    status: string;
    submittedAt: string;
    estimatedTotalUgx: number | null;
    lines: Array<{ productName: string; quantity: number | null; unitKind: string; unitCount: number | null; unitPriceUgx: number | null; lineTotalUgx: number | null }>;
  }>;
  orders: Array<{ orderNumber: string; placedAt: string; status: string; paymentStatus: string; totalUgx: number; itemCount: number }>;
  statement: Array<{ month: string; orders: number; totalUgx: number; paidUgx: number; unpaidOpenUgx: number }>;
}

export interface IDealerPortalReader {
  account(phone: string): Promise<DealerAccountView>;
}
