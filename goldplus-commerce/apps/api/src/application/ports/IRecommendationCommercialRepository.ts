import type { ATTRIBUTION_MODEL } from "./RecommendationAttributionModel";
export { ATTRIBUTION_MODEL } from "./RecommendationAttributionModel";

export interface AttributedLine {
  orderId: string;
  orderNumber: string;
  orderItemId: string;
  productId: string;
  productName: string;
  quantity: number;
  grossRevenueUgx: number;
  discountAllocatedUgx: number;
  /** Line revenue AFTER any refund allocated to this line (never below zero). */
  netRevenueUgx: number;
  /** How much of this line has been refunded, from the refund ledger (0103). */
  refundedUgx: number;
  cogsSnapshotUgx: number | null;
  mechanism: string;
  placement: string | null;
  ruleIds: string[] | null;
  utmCampaign: string | null;
  touchedAt: Date;
  orderStatus: string;
  orderCreatedAt: Date;
}

export interface CommercialTotals {
  windowDays: number;
  model: typeof ATTRIBUTION_MODEL;
  paidOrders: number;
  paidOrdersWithProfile: number;
  paidOrdersUnattributable: number;
  reversedOrdersExcluded: number;
  attributedOrders: number;
  attributedOrderItems: number;
  attributedUnits: number;
  directAttributedGrossUgx: number;
  directAttributedNetUgx: number;
  assistedNetUgx: number;
  organicPaidNetUgx: number;
  attributedLinesWithCogs: number;
  attributedCogsUgx: number;
  attributedGrossMarginUgx: number | null;
}

export interface CommercialFunnel {
  windowDays: number;
  impressions: number;
  clicks: number;
  addToCarts: number;
  profilesWithTouch: number;
  paidOrdersFromTouchedProfiles: number;
  fulfilledOrdersFromTouchedProfiles: number;
  completedOrdersFromTouchedProfiles: number;
}

export interface CustomerValueCohorts {
  cohorts: Array<{
    cohort: "recommendation_acquired" | "recommendation_assisted" | "not_exposed";
    customers: number;
    netRevenue30dUgx: number;
    netRevenue60dUgx: number;
    netRevenue90dUgx: number;
    repeatPurchasers: number;
  }>;
}

export interface CommercialDataQuality {
  windowDays: number;
  paidOrdersWithoutProfile: number;
  paidOrdersWithoutLines: number;
  atcWithoutPriorClickOrImpression: number;
  linesMissingCogsSnapshot: number;
  mediaSpendRows: number;
}

export interface IRecommendationCommercialRepository {
  getAttributedLines(windowDays: number, limit?: number): Promise<AttributedLine[]>;
  getCommercialTotals(windowDays: number): Promise<CommercialTotals>;
  getCommercialFunnel(windowDays: number): Promise<CommercialFunnel>;
  getCustomerValueCohorts(): Promise<CustomerValueCohorts>;
  getMediaSpend(windowDays: number): Promise<{
    /** A pure aggregate over EVERY row in the window — never a sum of a display page. */
    totalSpendMinor: number;
    /** Non-UGX currencies present in the window — any entry forces ROAS to refuse (MIXED_CURRENCY_SPEND). */
    mixedCurrencies: string[];
    campaigns: Array<{ campaign: string; spendMinor: number; currency: string }>;
    sources: number;
    /** Newest spend DAY covered (YYYY-MM-DD), or null when no spend exists. */
    newestSpendDate: string | null;
    /** When spend was last ingested — a feed that stopped is not a feed of zero. */
    newestIngestedAt: Date | null;
    /** Days between the newest spend day and today; null when no spend exists. */
    spendDataAgeDays: number | null;
  }>;
  getCommercialDataQuality(windowDays: number): Promise<CommercialDataQuality>;

  /** Every distinct currency ever ingested — used to refuse a poisoning batch at INGEST. */
  getIngestedCurrencies(): Promise<string[]>;

  /**
   * Operator view of the media-cost fact table: freshness (a feed that stopped
   * is not a feed of zero), totals and the most recently ingested facts, so the
   * import page can show what the ONE canonical table currently holds.
   */
  getMediaCostOpsSummary(limit: number): Promise<{
    totalFacts: number;
    currencies: string[];
    distinctSources: number;
    distinctCampaigns: number;
    newestSpendDate: string | null;
    newestIngestedAt: Date | null;
    spendDataAgeDays: number | null;
    recentFacts: Array<{
      spendDate: string;
      channel: string;
      platform: string;
      account: string;
      campaign: string;
      adSetOrGroup: string | null;
      adOrCreative: string | null;
      currency: string;
      spendMinor: number;
      taxOrFeeMinor: number;
      source: string;
      ingestedAt: Date;
    }>;
  }>;

  /**
   * Fix a spend fact already ingested. `on conflict do nothing` meant a wrong
   * number could never be corrected: the resubmission was silently discarded
   * and the report kept the bad figure. Returns the PREVIOUS values so the
   * caller can audit before-and-after.
   */
  correctMediaCostFact(input: {
    spendDate: string;
    channel: string;
    platform: string;
    account: string;
    campaign: string;
    adSetOrGroup?: string | null;
    adOrCreative?: string | null;
    source: string;
    spendMinor: number;
    taxOrFeeMinor: number;
  }): Promise<{ corrected: boolean; previous: { spendMinor: number; taxOrFeeMinor: number } | null }>;
}
