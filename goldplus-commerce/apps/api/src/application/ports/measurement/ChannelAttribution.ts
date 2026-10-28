import type { HeardAboutAnswer } from '@goldplus/shared';
import type { CodeTouch, CreditBasis, CreditRow, ObservedTouch, OrderCredit, ReportModel, SpendInput } from '../../../domain/measurement/ChannelReport';
import type { EntryTouch } from '../../../domain/measurement/EntryPages';

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
  linkVisitorTouches(input: { orderId: string; visitorId: string; orderAt: Date; lookbackDays: number; method: 'visitor' | 'whatsapp_ref' | 'stitched' }): Promise<number>;
  /** Every visitor id the identity graph (0155) links to this order's customer, other than the one on the order. */
  stitchedVisitorIds(orderId: string): Promise<string[]>;
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
  /**
   * Each order's entry visit among its linked touches in the lookback window: the first one with a source, else the
   * first direct one (domain/measurement/EntryPages). Orders with no linked touch are absent.
   */
  entryTouches(orderIds: string[], lookbackDays: number): Promise<EntryTouch[]>;
  /** A page of this environment's touches since `since`, oldest first, after the keyset cursor (reclassification). */
  touchesSince(since: Date, after: TouchCursor | null, limit: number): Promise<StoredTouch[]>;
  /** Rewrites the derived `channel` of the given touches; their recorded fields are never changed. */
  setTouchChannels(updates: Array<{ touchId: string; channel: string }>): Promise<number>;
}

/** A touch as recorded: the fields its channel is derived from (Channels.classifyChannel), and the channel on file. */
export interface StoredTouch {
  touchId: string;
  occurredAt: Date;
  channel: string;
  source: string | null;
  medium: string | null;
  referrerHost: string | null;
  clickIdTypes: string[];
}
export interface TouchCursor { occurredAt: Date; touchId: string }

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
