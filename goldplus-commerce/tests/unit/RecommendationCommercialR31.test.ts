import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RecommendationCommercialService } from "../../apps/api/src/application/recommendations/RecommendationCommercialService";
import { ATTRIBUTION_MODEL } from "../../apps/api/src/infrastructure/db/repositories/DrizzleRecommendationCommercialRepository";
import { resolveClientAddress } from "../../apps/api/src/domain/identity/ClientAddress";

/**
 * R3.1 (2026-08-06): commercial intelligence on top of f370b35. The pins hold
 * the honesty rules closed: unavailable never renders as zero, attributed is
 * never renamed incremental, profit is never derived from current prices, and
 * the stitching chain that makes PROVEN attribution possible stays intact.
 */

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function fakeRepo(over: {
  totals?: Partial<Awaited<ReturnType<import("../../apps/api/src/infrastructure/db/repositories/DrizzleRecommendationCommercialRepository").DrizzleRecommendationCommercialRepository["getCommercialTotals"]>>>;
  spendMinor?: number;
  mixedCurrencies?: string[];
  cohorts?: Array<{ cohort: string; customers: number; netRevenue30dUgx: number; netRevenue60dUgx: number; netRevenue90dUgx: number; repeatPurchasers: number }>;
} = {}) {
  return {
    async getCommercialTotals(windowDays: number) {
      return {
        windowDays,
        model: ATTRIBUTION_MODEL,
        paidOrders: 0,
        paidOrdersWithProfile: 0,
        paidOrdersUnattributable: 0,
        reversedOrdersExcluded: 0,
        attributedOrders: 0,
        attributedOrderItems: 0,
        attributedUnits: 0,
        directAttributedGrossUgx: 0,
        directAttributedNetUgx: 0,
        assistedNetUgx: 0,
        organicPaidNetUgx: 0,
        attributedLinesWithCogs: 0,
        attributedCogsUgx: 0,
        attributedGrossMarginUgx: null,
        ...over.totals,
      };
    },
    async getCommercialFunnel(windowDays: number) {
      return {
        windowDays,
        impressions: 12,
        clicks: 2,
        addToCarts: 1,
        profilesWithTouch: 3,
        paidOrdersFromTouchedProfiles: 0,
        fulfilledOrdersFromTouchedProfiles: 0,
        completedOrdersFromTouchedProfiles: 0,
      };
    },
    async getCustomerValueCohorts() {
      return { cohorts: (over.cohorts ?? []) as never };
    },
    async getMediaSpend() {
      return { totalSpendMinor: over.spendMinor ?? 0, mixedCurrencies: over.mixedCurrencies ?? [], campaigns: [], sources: 0 };
    },
    async getCommercialDataQuality(windowDays: number) {
      return {
        windowDays,
        paidOrdersWithoutProfile: 0,
        paidOrdersWithoutLines: 0,
        atcWithoutPriorClickOrImpression: 0,
        linesMissingCogsSnapshot: 0,
        mediaSpendRows: 0,
      };
    },
    async getAttributedLines() {
      return [];
    },
  };
}

describe("honest states — unavailable is a reason, never a zero (§16, AC8/AC13)", () => {
  it("today's production shape: revenue UNAVAILABLE with the linkage reason, ROAS UNAVAILABLE with MEDIA_COST_NOT_CONNECTED", async () => {
    const service = new RecommendationCommercialService(fakeRepo() as never);
    const report = await service.getCommercialReport(30);

    expect(report.revenue.directAttributedNetUgx.state).toBe("UNAVAILABLE");
    expect(report.revenue.directAttributedNetUgx.reason).toContain("NO_PAID_ORDERS");
    expect(report.roas.reportedRoas.state).toBe("UNAVAILABLE");
    expect(report.roas.reportedRoas.reason).toContain("MEDIA_COST_NOT_CONNECTED");
    expect(report.profit.contributionProfit.state).toBe("UNAVAILABLE");
    expect(report.profit.contributionProfit.reason).toContain("HISTORICAL_COGS_OR_COST_ALLOCATION_MISSING");
    // Never a bare zero standing in for the unavailable value.
    expect(report.revenue.directAttributedNetUgx.value).toBeUndefined();
  });

  it("paid orders WITHOUT profile stamps report ORDER_PAYMENT_LINKAGE_INCOMPLETE — historic orders are never inferred", async () => {
    const service = new RecommendationCommercialService(
      fakeRepo({ totals: { paidOrders: 5, paidOrdersUnattributable: 5 } }) as never,
    );
    const report = await service.getCommercialReport(30);
    expect(report.revenue.directAttributedNetUgx.state).toBe("UNAVAILABLE");
    expect(report.revenue.directAttributedNetUgx.reason).toContain("ORDER_PAYMENT_LINKAGE_INCOMPLETE");
    expect(report.revenue.directAttributedNetUgx.reason).toContain("UNATTRIBUTABLE");
  });

  it("funnel rates below their minimum denominators read NOT_ENOUGH_DATA, never 0.0%", async () => {
    const service = new RecommendationCommercialService(fakeRepo() as never);
    const report = await service.getCommercialReport(30);
    expect(report.funnel.impressionToPaidOrderRate.state).toBe("NOT_ENOUGH_DATA");
    expect(report.funnel.atcToPaidOrderRate.state).toBe("NOT_ENOUGH_DATA");
    expect(report.funnel.atcToPaidOrderRate.value).toBeUndefined();
  });

  it("attributed revenue is NEVER incremental revenue (§5.7), and predicted CLV is never actual", async () => {
    const service = new RecommendationCommercialService(
      fakeRepo({ totals: { paidOrders: 50, paidOrdersWithProfile: 50, directAttributedNetUgx: 1_000_000 } }) as never,
    );
    const report = await service.getCommercialReport(30);
    expect(report.revenue.directAttributedNetUgx.state).toBe("OK");
    expect(report.revenue.incrementalRevenue.state).toBe("UNAVAILABLE");
    expect(report.revenue.incrementalRevenue.reason).toContain("not incremental revenue");
    expect(report.customers.predictedClv.state).toBe("UNAVAILABLE");
  });

  it("ROAS activates from DATA alone once spend exists and linkage is complete (AC18/AC14 shape)", async () => {
    const service = new RecommendationCommercialService(
      fakeRepo({
        totals: { paidOrders: 20, paidOrdersWithProfile: 20, directAttributedNetUgx: 500_000 },
        spendMinor: 250_000,
      }) as never,
    );
    const report = await service.getCommercialReport(30);
    expect(report.roas.reportedRoas.state).toBe("OK");
    expect(report.roas.reportedRoas.value).toBe(2);
    // Contribution ROAS still needs cost truth — activating one metric never
    // fakes its stricter sibling.
    expect(report.roas.contributionRoas.state).toBe("UNAVAILABLE");
  });

  it("mixed-currency spend REFUSES ROAS instead of summing incomparable numbers (R9.1 review M1)", async () => {
    const service = new RecommendationCommercialService(
      fakeRepo({
        totals: { paidOrders: 20, paidOrdersWithProfile: 20, directAttributedNetUgx: 500_000 },
        spendMinor: 250_000,
        mixedCurrencies: ["USD"],
      }) as never,
    );
    const report = await service.getCommercialReport(30);
    expect(report.roas.reportedRoas.state).toBe("UNAVAILABLE");
    expect(report.roas.reportedRoas.reason).toContain("MIXED_CURRENCY_SPEND");
  });

  it("gross margin over lines WITH cost snapshots is PARTIAL with named missing components (AC11/AC12)", async () => {
    const service = new RecommendationCommercialService(
      fakeRepo({
        totals: {
          paidOrders: 5,
          paidOrdersWithProfile: 5,
          attributedLinesWithCogs: 2,
          attributedCogsUgx: 40_000,
          attributedGrossMarginUgx: 60_000,
        },
      }) as never,
    );
    const report = await service.getCommercialReport(30);
    expect(report.profit.attributedGrossMarginUgx.state).toBe("PARTIAL");
    expect(report.profit.attributedGrossMarginUgx.value).toBe(60_000);
    expect(report.profit.contributionProfit.state).toBe("UNAVAILABLE");
    expect((report.profit.contributionProfit.missingComponents ?? []).join(" ")).toContain("payment fee");
  });

  it("cohorts below the customer minimum carry counts but claim nothing (AC8)", async () => {
    const service = new RecommendationCommercialService(
      fakeRepo({ cohorts: [{ cohort: "not_exposed", customers: 3, netRevenue30dUgx: 90_000, netRevenue60dUgx: 90_000, netRevenue90dUgx: 90_000, repeatPurchasers: 0 }] }) as never,
    );
    const report = await service.getCommercialReport(30);
    expect(report.customers.cohorts.state).toBe("NOT_ENOUGH_DATA");
    expect(report.customers.cohorts.value).toHaveLength(1);
    expect(report.customers.cohorts.reason).toContain("anecdotes");
  });
});

describe("the projection's SQL encodes the truth rules (C2/C4)", () => {
  const repo = read("apps/api/src/infrastructure/db/repositories/DrizzleRecommendationCommercialRepository.ts");

  it("paid truth excludes cancelled orders and FULLY refunded orders in EVERY revenue query", () => {
    const paidBlocks = repo.split("payment_status = 'paid'").length - 1;
    // 2026-08-07: the exclusion moved from "any reversed payment attempt" to
    // "fully refunded per the ledger". The old test assumed every reversal was
    // total, which is exactly the assumption that let a partial refund erase a
    // whole order's revenue. A partial now reduces the line it was made
    // against instead of deleting the order.
    const fullyRefundedBlocks = repo.split("fully_refunded_orders fr where fr.order_id").length - 1;
    expect(paidBlocks).toBeGreaterThanOrEqual(5);
    expect(fullyRefundedBlocks).toBeGreaterThanOrEqual(5);
    // And the old whole-order test must not creep back in.
    expect(repo).not.toContain("pa.status = 'reversed'");
  });

  it("a partial refund is subtracted from its own line, and never below zero", () => {
    expect(repo).toContain("greatest(oi.final_line_total - coalesce(lr.refunded_ugx, 0), 0)");
    // Only allocations against non-rejected refunds count.
    expect(repo).toContain("where pr.status <> 'rejected'");
  });

  it("one primary per order line — DISTINCT ON with deterministic strength-then-recency ordering (AC16)", () => {
    expect(repo).toContain("select distinct on (oi.id)");
    expect(repo).toContain("order by oi.id, t.strength desc, t.created_at desc");
  });

  it("impressions can NEVER become a primary attribution — they live only in the assisted CTE (§5.3)", () => {
    const primaryBlock = repo.slice(repo.indexOf("getAttributedLines"), repo.indexOf("getCommercialTotals"));
    expect(primaryBlock).not.toContain("RECOMMENDATION_IMPRESSION");
    const totalsBlock = repo.slice(repo.indexOf("getCommercialTotals"), repo.indexOf("getCommercialFunnel"));
    expect(totalsBlock).toContain("assisted_lines");
    expect(totalsBlock).toContain("RECOMMENDATION_IMPRESSION");
    // Assisted lines exclude anything with a primary attribution — no double count (AC3).
    expect(totalsBlock).toContain("not exists (select 1 from attributed_lines al where al.id = oi.id)");
  });

  it("the identity join is the server profile — no name/phone/time-proximity join exists", () => {
    expect(repo).toContain("t.profile_id = o.profile_id");
    expect(repo).not.toMatch(/customer_phone|customer_name|customer_email/);
  });
});

describe("the stitching chain that makes PROVEN attribution possible", () => {
  it("checkout SSR forwards the visit token; the route resolves it server-side; the insert writes profile_id and cart_id", () => {
    expect(read("apps/web/src/pages/checkout.astro")).toContain("visitToken: Astro.locals.gpVisit");
    expect(read("apps/web/src/lib/checkoutClient.ts")).toContain("headers['x-gp-visit'] = args.visitToken");
    const route = read("apps/api/src/interfaces/http/routes/commerce.ts");
    expect(route).toContain("resolveExperienceProfileUseCase.execute(rawVisitToken)");
    expect(route).toContain("profileId: checkoutProfileId");
    const repo = read("apps/api/src/infrastructure/db/repositories/DrizzleOrderRepository.ts");
    expect(repo).toContain("profileId: input.stitching?.profileId ?? null");
  });

  it("COGS freezes at order creation from cost_price, and NULL cost stays NULL — never zero (AC11)", () => {
    const repo = read("apps/api/src/infrastructure/db/repositories/DrizzleOrderRepository.ts");
    expect(repo).toContain("cogsSnapshotUgx: typeof cost === 'number' && cost >= 0 ? cost * item.quantity : null");
  });

  it("migrations 0101/0102 are additive with zero inserts and registered in the journal", () => {
    for (const file of ["0101_order_profile_stitching.sql", "0102_commercial_costs.sql"]) {
      const migration = read(`apps/api/src/infrastructure/db/migrations/${file}`);
      expect(migration, file).not.toMatch(/\bINSERT\s+INTO\b/i);
    }
    const journal = read("apps/api/src/infrastructure/db/migrations/meta/_journal.json");
    expect(journal).toContain("0101_order_profile_stitching");
    expect(journal).toContain("0102_commercial_costs");
  });
});

describe("JSONB is canonical at the writers (AC21/AC22)", () => {
  it("both writers cast ONE stringify to ::jsonb; readers keep historic tolerance", () => {
    const events = read("apps/api/src/infrastructure/db/repositories/DrizzleRecommendationEventRepository.ts");
    expect(events).toContain("sql`${event.metadata ?? {}}::jsonb`");
    const reader = read("apps/api/src/infrastructure/db/repositories/DrizzleProductRecommendationReader.ts");
    expect(reader).toContain("sql`${items as never}::jsonb`");
    expect(reader).toContain('typeof row.items === "string" ? JSON.parse(row.items) : row.items');
    const analytics = read("apps/api/src/infrastructure/db/repositories/DrizzleRecommendationAnalyticsRepository.ts");
    expect(analytics).toContain("jsonb_typeof(metadata) = 'string'");
  });
});

describe("the relay residual is CLOSED — per-visitor attribution at the trusted-proxy layer", () => {
  it("CADDY_EDGE trusts one forwarded hop, so the relay's X-Forwarded-For resolves the REAL client as TRUSTED", () => {
    // The R9 relay forwards the storefront visitor's address; the API's
    // topology (one trusted hop) resolves it — a relay-carried event is
    // attributed to ITS visitor, not to the web container.
    const resolved = resolveClientAddress({
      remoteAddress: "172.18.0.7", // the web container, as the API sees it
      forwardedFor: "203.0.113.42",
      realIp: null,
      trustedHops: 1,
    } as never);
    expect(resolved.ip).toBe("203.0.113.42");
    expect(resolved.confidence).toBe("TRUSTED");
    const relay = read("apps/web/src/pages/api/rec/[...path].ts");
    expect(relay).toContain('headers["X-Forwarded-For"]');
  });
});

describe("media-cost ingestion is server-side and duplicate-protected (§12)", () => {
  it("the route validates every dimension, rejects negative spend, and only recommendations.manage may write", () => {
    const routes = read("apps/api/src/interfaces/http/routes/admin/recommendations.ts");
    expect(routes).toContain('routes.post("/media-costs", requirePermissions([PERMISSIONS.RECOMMENDATIONS_MANAGE])');
    expect(routes).toContain("spendMinor must be a non-negative integer");
    const migration = read("apps/api/src/infrastructure/db/migrations/0102_commercial_costs.sql");
    expect(migration).toContain("media_cost_facts_logical_uq");
    expect(migration).toContain('CHECK ("spend_minor" >= 0');
  });

  it("R4: the operator has a real import page and a read-gated summary — spend never requires curl", () => {
    const routes = read("apps/api/src/interfaces/http/routes/admin/recommendations.ts");
    // Reads are gated on the READ permission and bounded; writes stay on MANAGE.
    expect(routes).toContain('routes.get("/media-costs/summary", requirePermissions([PERMISSIONS.RECOMMENDATIONS_READ])');
    expect(routes).toContain('Math.min(200, Math.max(1, Number(c.req.query("limit"))');

    const page = read("apps/web/src/pages/admin/media-costs.astro");
    // The page drives the SAME batch endpoint (dry run then apply), never a
    // parallel write path, and surfaces per-row errors and freshness.
    expect(page).toContain("/admin/recommendations/media-costs/batch");
    expect(page).toContain("/admin/recommendations/media-costs/correct");
    expect(page).toContain("/admin/recommendations/media-costs/summary");
    expect(page).toContain('dryRun: intent !== "apply"');
    expect(page).toContain("readSessionToken(Astro.request)");
    // Missing spend stays a truthful absence on the page too — never a zero.
    expect(page).toContain("a feed that stopped is not a feed of zero");
  });
});
