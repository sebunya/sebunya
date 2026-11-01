import type { BulkUnit } from '../../domain/quotes/BulkQuoteRequest';

/** How one product is bought in bulk. dealerPriceUgx is secured: only gated reads return it. */
export interface BulkTerms {
  productId: string;
  bulkUnit: BulkUnit;
  unitsPerCarton: number | null;
  /** Per piece; null when not set. */
  dealerPriceUgx: number | null;
}

export interface BulkTermsAdminRow extends BulkTerms {
  sku: string;
  modelNumber: string;
  name: string;
  categoryName: string | null;
  retailPriceUgx: number | null;
  /** Price A: shown beside the dealer price so the team sees the margin of safety. */
  floorPriceUgx: number | null;
  onSale: boolean;
}

export interface BulkTermsChange {
  bulkUnit: BulkUnit;
  unitsPerCarton: number | null;
  dealerPriceUgx: number | null;
}

export interface IBulkTermsRepository {
  /** Products on sale (approved and active); all of them when ids is omitted. */
  findOnSale(ids?: string[]): Promise<BulkTerms[]>;
  /** Every product, on sale or not, for the admin. */
  listForAdmin(): Promise<BulkTermsAdminRow[]>;
  /** Writes the three fields together, or none of them. */
  update(productId: string, change: BulkTermsChange): Promise<'updated' | 'not_found' | 'no_retail_price'>;
}
