import {
  ATTRIBUTION_MODEL,
  type AttributedLine,
  type CommercialTotals,
  type IRecommendationCommercialRepository,
} from "../ports/IRecommendationCommercialRepository";

/**
 * The commercial-intelligence envelope (R3.1 C2–C7).
 *
 * Every metric leaves here as { state, value?, reason?, ... } — never a bare
 * number that could be mistaken for truth it doesn't have:
 *
 *   OK                — computed from complete canonical linkage
 *   NOT_ENOUGH_DATA   — denominator below its minimum; no rate is shown
 *   PARTIAL           — computed over the subset with complete inputs, with
 *                       the missing components NAMED
 *   UNAVAILABLE       — a required source does not exist yet; the REASON says
 *                       exactly which one, and the metric activates from data
 *                       alone when it appears (AC18)
 *
 * Nothing here writes. Refund reversal is inherited from the projection
 * (reversed orders never enter), so a reversal can never be double-applied.
 */

const MIN_ORDERS_FOR_RATES = 10;
const MIN_CUSTOMERS_FOR_COHORTS = 10;

export type MetricState = "OK" | "NOT_ENOUGH_DATA" | "PARTIAL" | "UNAVAILABLE";

export interface Metric<T = number> {
  state: MetricState;
  value?: T;
  reason?: string;
  numerator?: number;
  denominator?: number;
  minSample?: number;
  missingComponents?: string[];
}

const notEnough = (numerator: number, denominator: number, minSample: number): Metric => ({
  state: "NOT_ENOUGH_DATA",
  numerator,
  denominator,
  minSample,
  reason: `Denominator ${denominator} is below the ${minSample} minimum — a rate here would be noise.`,
});

const rate = (numerator: number, denominator: number, minSample: number): Metric =>
  denominator >= minSample
    ? { state: "OK", value: Math.round((numerator / denominator) * 10_000) / 100, numerator, denominator }
    : notEnough(numerator, denominator, minSample);

export class RecommendationCommercialService {
  constructor(private readonly repo: IRecommendationCommercialRepository) {}

  async getCommercialReport(windowDays = 30): Promise<{
    windowDays: number;
    attributionModel: typeof ATTRIBUTION_MODEL;
    totals: CommercialTotals;
    revenue: {
      directAttributedGrossUgx: Metric;
      directAttributedNetUgx: Metric;
      assistedNetUgx: Metric;
      organicPaidNetUgx: Metric;
      incrementalRevenue: Metric;
    };
    funnel: {
      raw: Awaited<ReturnType<IRecommendationCommercialRepository["getCommercialFunnel"]>>;
      impressionToPaidOrderRate: Metric;
      clickToPaidOrderRate: Metric;
      atcToPaidOrderRate: Metric;
      paidToCompletedRate: Metric;
    };
    profit: {
      attributedGrossMarginUgx: Metric;
      contributionProfit: Metric;
    };
    customers: {
      cohorts: Metric<Awaited<ReturnType<IRecommendationCommercialRepository["getCustomerValueCohorts"]>>["cohorts"]>;
      predictedClv: Metric;
    };
    roas: {
      reportedRoas: Metric;
      contributionRoas: Metric;
      mediaSpendMinor: number;
      newestSpendDate: string | null;
      spendDataAgeDays: number | null;
      spendFreshness: "NO_SPEND_INGESTED" | "CURRENT" | "LAGGING" | "STALE";
    };
    dataQuality: Awaited<ReturnType<IRecommendationCommercialRepository["getCommercialDataQuality"]>>;
    attributedLines: AttributedLine[];
  }> {
    const clamped = Math.min(365, Math.max(1, windowDays));
    const [totals, funnel, cohortsRaw, spend, dataQuality, lines] = await Promise.all([
      this.repo.getCommercialTotals(clamped),
      this.repo.getCommercialFunnel(clamped),
      this.repo.getCustomerValueCohorts(),
      this.repo.getMediaSpend(clamped),
      this.repo.getCommercialDataQuality(clamped),
      this.repo.getAttributedLines(clamped, 50),
    ]);

    const linkageExists = totals.paidOrdersWithProfile > 0;

    const revenueMetric = (value: number): Metric =>
      linkageExists
        ? { state: "OK", value }
        : {
            state: "UNAVAILABLE",
            reason:
              totals.paidOrders > 0
                ? "ORDER_PAYMENT_LINKAGE_INCOMPLETE: paid orders exist but none carry a server profile stamp yet (stamping began 2026-08-06; historic orders are UNATTRIBUTABLE, never inferred)."
                : "NO_PAID_ORDERS: no paid order exists in the window.",
          };

    const totalCustomers = cohortsRaw.cohorts.reduce((s, c) => s + c.customers, 0);

    const missingProfitComponents = [
      ...(dataQuality.linesMissingCogsSnapshot > 0 || totals.attributedLinesWithCogs === 0
        ? ["COGS snapshots (no product cost is set — enter or import costs at Admin → Product costs, then new orders freeze a cost at sale)"]
        : []),
      "payment fee allocation (no per-order fee source)",
      "delivery cost allocation (fee is revenue-side only)",
      "promotion cost allocation",
    ];

    return {
      windowDays: clamped,
      attributionModel: ATTRIBUTION_MODEL,
      totals,
      revenue: {
        directAttributedGrossUgx: revenueMetric(totals.directAttributedGrossUgx),
        directAttributedNetUgx: revenueMetric(totals.directAttributedNetUgx),
        assistedNetUgx: revenueMetric(totals.assistedNetUgx),
        organicPaidNetUgx:
          totals.paidOrders > 0
            ? { state: "OK", value: totals.organicPaidNetUgx }
            : { state: "UNAVAILABLE", reason: "NO_PAID_ORDERS" },
        // §5.7: attributed is NEVER renamed incremental. This stays
        // UNAVAILABLE until a valid experiment with holdout + SRM + sample
        // exists — no configuration can switch it on early.
        incrementalRevenue: {
          state: "UNAVAILABLE",
          reason: "NO_VALID_EXPERIMENT: incrementality requires a holdout experiment with stable assignment, exposure logging, SRM checks and sufficient sample. Attributed revenue is not incremental revenue.",
        },
      },
      funnel: {
        raw: funnel,
        impressionToPaidOrderRate: rate(funnel.paidOrdersFromTouchedProfiles, funnel.impressions, 100),
        clickToPaidOrderRate: rate(funnel.paidOrdersFromTouchedProfiles, funnel.clicks, 25),
        atcToPaidOrderRate: rate(funnel.paidOrdersFromTouchedProfiles, funnel.addToCarts, MIN_ORDERS_FOR_RATES),
        paidToCompletedRate: rate(
          funnel.completedOrdersFromTouchedProfiles,
          funnel.paidOrdersFromTouchedProfiles,
          MIN_ORDERS_FOR_RATES,
        ),
      },
      profit: {
        attributedGrossMarginUgx:
          totals.attributedGrossMarginUgx !== null
            ? {
                state: "PARTIAL",
                value: totals.attributedGrossMarginUgx,
                reason: `Computed over the ${totals.attributedLinesWithCogs} attributed line(s) whose COGS snapshot exists; lines without a cost are excluded, never zero-filled.`,
                missingComponents: missingProfitComponents.slice(1),
              }
            : {
                state: "UNAVAILABLE",
                reason: "HISTORICAL_COGS_OR_COST_ALLOCATION_MISSING: no attributed line carries a COGS snapshot. Snapshots freeze at order creation once product cost_price is entered.",
                missingComponents: missingProfitComponents,
              },
        contributionProfit: {
          state: "UNAVAILABLE",
          reason: "HISTORICAL_COGS_OR_COST_ALLOCATION_MISSING: contribution needs COGS plus payment-fee, delivery and promotion allocations. Missing components are listed — partial gross margin is reported separately, never presented as final profit.",
          missingComponents: missingProfitComponents,
        },
      },
      customers: {
        cohorts:
          totalCustomers >= MIN_CUSTOMERS_FOR_COHORTS
            ? { state: "OK", value: cohortsRaw.cohorts }
            : {
                state: "NOT_ENOUGH_DATA",
                value: cohortsRaw.cohorts,
                denominator: totalCustomers,
                minSample: MIN_CUSTOMERS_FOR_COHORTS,
                reason: `Only ${totalCustomers} paying customer(s) exist — cohort comparisons below ${MIN_CUSTOMERS_FOR_COHORTS} are anecdotes. Raw counts are shown; no cohort claims are made. Guest checkouts (no account) are outside cohorts by definition — value cohorts need a durable customer identity.`,
              },
        predictedClv: {
          state: "UNAVAILABLE",
          reason: "NO_VALIDATED_MODEL: predicted CLV requires purchase history and a validated model. Realised value is reported; a forecast is never labelled as actual.",
        },
      },
      roas: {
        reportedRoas:
          spend.mixedCurrencies.length > 0
            ? {
                state: "UNAVAILABLE",
                reason: `MIXED_CURRENCY_SPEND: spend exists in ${spend.mixedCurrencies.join(", ")} with no conversion source — a cross-currency sum is not a number. Ingest UGX or connect a conversion source.`,
              }
            : spend.totalSpendMinor > 0 && linkageExists
            ? {
                state: "OK",
                value: Math.round((totals.directAttributedNetUgx / spend.totalSpendMinor) * 100) / 100,
                reason: "attributed_net_revenue / media_spend over campaigns with recorded spend.",
              }
            : {
                state: "UNAVAILABLE",
                reason:
                  spend.totalSpendMinor === 0
                    ? "MEDIA_COST_NOT_CONNECTED: no media spend rows exist. Ingest spend and ROAS activates from data alone."
                    : "ORDER_PAYMENT_LINKAGE_INCOMPLETE",
              },
        contributionRoas: {
          state: "UNAVAILABLE",
          reason:
            spend.totalSpendMinor === 0
              ? "MEDIA_COST_NOT_CONNECTED"
              : "HISTORICAL_COGS_OR_COST_ALLOCATION_MISSING: contribution ROAS needs contribution profit, which needs cost truth.",
        },
        mediaSpendMinor: spend.totalSpendMinor,
        // Freshness, so a feed that STOPPED is distinguishable from a period
        // that genuinely had no spend. Both read as a small number otherwise.
        newestSpendDate: spend.newestSpendDate,
        spendDataAgeDays: spend.spendDataAgeDays,
        spendFreshness:
          spend.newestSpendDate === null
            ? "NO_SPEND_INGESTED"
            : (spend.spendDataAgeDays ?? 0) <= 2
            ? "CURRENT"
            : (spend.spendDataAgeDays ?? 0) <= 7
            ? "LAGGING"
            : "STALE",
      },
      dataQuality,
      attributedLines: lines,
    };
  }
}
