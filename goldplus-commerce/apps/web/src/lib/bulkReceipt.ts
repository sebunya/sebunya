/**
 * The one-hour receipt a bulk quote leaves on the device (httpOnly, path /bulk),
 * so the confirmation page can look the request up with the same proof a buyer
 * would type at /bulk/status: the reference and the phone.
 */
export const BULK_RECEIPT_COOKIE = 'gp_bulk_receipt';

export interface BulkReceipt {
  reference: string;
  phone: string;
}

export function encodeBulkReceipt(receipt: BulkReceipt): string {
  return encodeURIComponent(JSON.stringify({ r: receipt.reference.slice(0, 16), p: receipt.phone.slice(0, 32) }));
}

export function decodeBulkReceipt(raw: string | undefined | null): BulkReceipt | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(decodeURIComponent(raw)) as { r?: unknown; p?: unknown };
    if (typeof data.r !== 'string' || typeof data.p !== 'string') return null;
    if (!/^BQ-[A-Z0-9]{6}$/.test(data.r) || !/^[+\d\s]{9,20}$/.test(data.p)) return null;
    return { reference: data.r, phone: data.p };
  } catch {
    return null;
  }
}
