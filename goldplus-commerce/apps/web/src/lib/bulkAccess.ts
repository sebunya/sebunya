import { apiBase } from './api';
import type { BulkTermsRow } from './bulkCatalogue';

/**
 * Bulk prices behind a verified phone (docs/bulk-buying/DESIGN.md §12).
 *
 * The token a verified phone earns lives ONLY in this httpOnly cookie: the
 * browser's script never sees it, and the storefront server passes it to the
 * API when it renders /bulk or relays a request. Server-only module.
 */
export const BULK_ACCESS_COOKIE = 'gp_bulk_access';

export interface BulkTermsRead {
  ok: boolean;
  pricesUnlocked: boolean;
  maskedPhone: string | null;
  /** Products with a bulk price; 0 = nothing to unlock, so the page does not ask for a phone. */
  pricedCount: number;
  terms: Map<string, BulkTermsRow>;
}

/** A token is opaque here; this only stops junk from being forwarded. */
export function readAccessCookie(value: string | undefined | null): string | null {
  return typeof value === 'string' && /^b1\.\d{12}\.\d{13}\.[0-9a-f]{64}$/.test(value) ? value : null;
}

export async function fetchBulkTerms(token: string | null): Promise<BulkTermsRead> {
  const empty: BulkTermsRead = { ok: false, pricesUnlocked: false, maskedPhone: null, pricedCount: 0, terms: new Map() };
  try {
    const res = await fetch(`${apiBase}/quotes/bulk-terms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(token ? { token } : {}),
      signal: AbortSignal.timeout(8_000),
    });
    const json = (await res.json().catch(() => null)) as
      | { success?: boolean; data?: { pricesUnlocked?: boolean; maskedPhone?: string | null; pricedCount?: number; terms?: BulkTermsRow[] } }
      | null;
    if (!res.ok || !json?.success || !Array.isArray(json.data?.terms)) return empty;
    const terms = new Map<string, BulkTermsRow>();
    for (const t of json.data!.terms!) {
      if (t && typeof t.productId === 'string') terms.set(t.productId.toLowerCase(), t);
    }
    const pricedCount = Number(json.data!.pricedCount);
    return { ok: true, pricesUnlocked: json.data!.pricesUnlocked === true, maskedPhone: json.data!.maskedPhone ?? null, pricedCount: Number.isFinite(pricedCount) ? pricedCount : 0, terms };
  } catch {
    return empty;
  }
}
