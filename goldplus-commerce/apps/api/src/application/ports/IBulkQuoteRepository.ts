import type {
  BulkBuyerType,
  BulkQuoteLine,
  BulkQuoteTotals,
  QuoteRequestStatus,
} from '../../domain/quotes/BulkQuoteRequest';

/** A new bulk request, fully validated and snapshotted by the use case. */
export interface NewBulkQuoteRecord {
  id: string;
  reference: string;
  idempotencyKey: string;
  requestFingerprint: string;
  customerName: string;
  businessName: string | null;
  phone: string;
  /** '' when not given (the legacy column is NOT NULL). */
  email: string;
  buyerType: BulkBuyerType;
  deliveryDistrict: string | null;
  neededBy: string | null;
  notes: string;
  /** Legacy one-line summary columns. */
  productName: string;
  quantity: string;
  lines: BulkQuoteLine[];
  totals: BulkQuoteTotals;
  createdAt: Date;
}

/** Any quote request as the team sees it: a legacy single-product row or a bulk list. */
export interface QuoteRequestView {
  id: string;
  reference: string | null;
  source: 'form' | 'bulk_builder';
  status: QuoteRequestStatus | string;
  customerName: string;
  businessName: string | null;
  phone: string;
  email: string;
  buyerType: string | null;
  deliveryDistrict: string | null;
  neededBy: string | null;
  notes: string;
  /** Legacy columns: the free-text product and quantity of a single-product request. */
  productName: string;
  quantity: string;
  requestFingerprint: string | null;
  lines: BulkQuoteLine[];
  totals: BulkQuoteTotals;
  createdAt: Date;
  updatedAt: Date | null;
}

export type CreateBulkQuoteOutcome = 'created' | 'duplicate_idempotency_key' | 'duplicate_reference';

export interface IBulkQuoteRepository {
  /** Header and lines in one transaction. A unique clash is reported, never thrown. */
  create(record: NewBulkQuoteRecord): Promise<CreateBulkQuoteOutcome>;
  findByIdempotencyKey(key: string): Promise<QuoteRequestView | null>;
  findByReference(reference: string): Promise<QuoteRequestView | null>;
  findById(id: string): Promise<QuoteRequestView | null>;
  /** Newest first. */
  list(opts: { limit: number }): Promise<QuoteRequestView[]>;
  /** Compare-and-set on the current status, so two admins cannot both move it. */
  updateStatus(id: string, from: string, to: QuoteRequestStatus, at: Date): Promise<boolean>;
}
