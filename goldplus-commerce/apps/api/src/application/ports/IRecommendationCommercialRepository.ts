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
    totalSpendMinor: number;
    /** Non-UGX currencies present in the window — any entry forces ROAS to refuse (MIXED_CURRENCY_SPEND). */
    mixedCurrencies: string[];
    campaigns: Array<{ campaign: string; spendMinor: number; currency: string }>;
    sources: number;
  }>;
  getCommercialDataQuality(windowDays: number): Promise<CommercialDataQuality>;
}
