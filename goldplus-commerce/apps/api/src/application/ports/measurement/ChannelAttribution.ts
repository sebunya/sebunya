import type { HeardAboutAnswer } from '@goldplus/shared';
import type { CodeTouch, CreditBasis, CreditRow, ObservedTouch, OrderCredit, ReportModel, SpendInput } from '../../../domain/measurement/ChannelReport';

/** The facts one order's attribution is computed from. */
export interface OrderAttributionFacts {
  orderId: string;
  orderNumber: string;
  orderAt: Date;
  status: string;
  paymentStatus: string;
  paymentMethod: string | null;
  totalUGX: number;
  deliveryFeeUGX: number;
  /** The server-set visitor id the checkout recorded (order_attribution.fp_client_id). */
  visitorId: string | null;
  /** Touches already linked to the order, oldest first. */
  observed: ObservedTouch[];
  code: CodeTouch | null;
  /** Newest first. */
  reports: SourceReportRow[];
}

export interface SourceReportRow {
  reportedBy: 'customer' | 'admin';
  answer: HeardAboutAnswer | null;
  whatsappRef: string | null;
  note: string | null;
  createdAt: Date;
}

export interface SaleFacts {
  orderId: string;
  orderAt: Date;
  status: string;
  paymentStatus: string;
  paymentMethod: string | null;
  totalUGX: number;
  deliveryFeeUGX: number;
}

export interface ChannelAttributionStore {
  loadOrder(orderId: string): Promise<OrderAttributionFacts | null>;
  /** Links the visitor's customer touches in (orderAt − lookback, orderAt]. Returns how many were new. */
  linkVisitorTouches(input: { orderId: string; visitorId: string; orderAt: Date; lookbackDays: number; method: 'visitor' | 'whatsapp_ref' }): Promise<number>;
  /** Replaces the order's credits in one transaction (derived data, recomputable). */
  replaceCredits(orderId: string, credits: OrderCredit[], modelVersion: string): Promise<void>;
  recordSourceReport(input: { orderId: string; reportedBy: 'customer' | 'admin'; answer: HeardAboutAnswer | null; whatsappRef: string | null; note: string | null; actorId: string | null }): Promise<void>;
  /** The visitor a WhatsApp reference was issued to, or null. */
  findWhatsAppRef(code: string): Promise<{ visitorId: string; issuedAt: Date } | null>;
  /** Orders placed in [from, to), newest first, bounded. */
  orderIdsPlacedBetween(from: Date, to: Date, limit: number): Promise<string[]>;
  salesBetween(from: Date, to: Date): Promise<SaleFacts[]>;
  creditsBetween(model: ReportModel, from: Date, to: Date): Promise<CreditRow[]>;
  /** Stored credits for one order, every model. */
  creditsForOrder(orderId: string): Promise<Array<{ model: string; channel: string; detail: string; weight: number; creditedUGX: bigint; basis: CreditBasis; computedAt: Date }>>;
}

/**
 * Advertising spend by week and report channel. `NOT_AVAILABLE` when no spend
 * source exists: the report then says "No spend data", never 0.
 */
export interface ChannelSpendSource {
  weeklySpend(from: Date, to: Date): Promise<SpendInput>;
}

export interface AttributionAuditPort {
  execute(input: { actorId: string; action: string; entity: string; entityId: string; newState?: Record<string, unknown> }): Promise<unknown>;
}
