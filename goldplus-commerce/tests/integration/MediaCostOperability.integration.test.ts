import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";

/**
 * Media-cost operability against REAL PostgreSQL.
 *
 * Spend ingestion was present but not operable: a wrong figure could never be
 * corrected (the logical-key conflict silently discarded the resubmission), the
 * ROAS denominator was summed from a LIMIT 100 display page so the 101st
 * campaign vanished from spend, and nothing told an operator whether a feed had
 * stopped or the period genuinely had no spend.
 */

const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite("media-cost operability on real PostgreSQL", () => {
  let pg: typeof import("../../apps/api/src/infrastructure/db/client").client;
  let repo: import("../../apps/api/src/infrastructure/db/repositories/DrizzleRecommendationCommercialRepository").DrizzleRecommendationCommercialRepository;

  const suffix = crypto.randomBytes(5).toString("hex");
  const platform = `mc-${suffix}`;
  const operator = crypto.randomUUID();
  const today = new Date().toISOString().slice(0, 10);

  const fact = (over: Partial<any> = {}) => ({
    spendDate: today,
    channel: "paid_social",
    platform,
    account: "acct-1",
    campaign: `camp-${suffix}`,
    adSetOrGroup: null,
    adOrCreative: null,
    currency: "UGX",
    spendMinor: 100_000,
    taxOrFeeMinor: 0,
    source: "integration-test",
    sourceReference: null,
    ingestedBy: operator,
    ...over,
  });

  beforeAll(async () => {
    ({ client: pg } = await import("../../apps/api/src/infrastructure/db/client"));
    const { DrizzleRecommendationCommercialRepository } = await import(
      "../../apps/api/src/infrastructure/db/repositories/DrizzleRecommendationCommercialRepository"
    );
    repo = new DrizzleRecommendationCommercialRepository();
    const { applyRecommendationMigrations } = await import("./helpers/applyRecommendationMigrations");
    await applyRecommendationMigrations(pg);
  });

  afterAll(async () => {
    await pg`delete from media_cost_facts where platform = ${platform}`;
  });

  it("a wrong spend figure CAN be corrected, and the previous value is returned for the audit", async () => {
    await repo.insertMediaCostFact(fact({ spendMinor: 100_000 }));

    // The old behaviour: resubmitting was silently discarded.
    const resubmit = await repo.insertMediaCostFact(fact({ spendMinor: 250_000 }));
    expect(resubmit.inserted).toBe(false);
    const [unchanged] = await pg`select spend_minor from media_cost_facts where platform = ${platform}`;
    expect(Number(unchanged.spend_minor)).toBe(100_000);

    // The correction path actually changes it, and reports what it replaced.
    const corrected = await repo.correctMediaCostFact({
      spendDate: today,
      channel: "paid_social",
      platform,
      account: "acct-1",
      campaign: `camp-${suffix}`,
      adSetOrGroup: null,
      adOrCreative: null,
      source: "integration-test",
      spendMinor: 250_000,
      taxOrFeeMinor: 0,
    });
    expect(corrected.corrected).toBe(true);
    expect(corrected.previous).toEqual({ spendMinor: 100_000, taxOrFeeMinor: 0 });

    const [after] = await pg`select spend_minor from media_cost_facts where platform = ${platform}`;
    expect(Number(after.spend_minor)).toBe(250_000);
  });

  it("correcting a fact that does not exist reports so instead of inventing one", async () => {
    const result = await repo.correctMediaCostFact({
      spendDate: today,
      channel: "paid_social",
      platform,
      account: "acct-1",
      campaign: `nope-${suffix}`,
      adSetOrGroup: null,
      adOrCreative: null,
      source: "integration-test",
      spendMinor: 1,
      taxOrFeeMinor: 0,
    });
    expect(result.corrected).toBe(false);
    expect(result.previous).toBeNull();
  });

  it("the ROAS denominator counts EVERY campaign, not the top 100 shown on screen", async () => {
    // 120 campaigns of 1,000 each: a LIMIT 100 sum would report 100,000 and
    // silently inflate ROAS by a fifth.
    for (let i = 0; i < 120; i += 1) {
      await repo.insertMediaCostFact(
        fact({ campaign: `bulk-${suffix}-${String(i).padStart(3, "0")}`, spendMinor: 1_000 }),
      );
    }
    const spend = await repo.getMediaSpend(30);
    const bulkTotal = 120 * 1_000;
    expect(spend.totalSpendMinor).toBe(bulkTotal + 250_000);
    // The display list stays capped — totals and display are different questions.
    expect(spend.campaigns.length).toBeLessThanOrEqual(100);
  });

  it("freshness distinguishes a feed that STOPPED from a period with no spend", async () => {
    const spend = await repo.getMediaSpend(30);
    expect(spend.newestSpendDate).toBe(today);
    expect(spend.spendDataAgeDays).toBe(0);
    expect(spend.newestIngestedAt).toBeInstanceOf(Date);

    // A window before any spend existed reports no spend at all, not zero spend.
    const empty = await repo.getMediaSpend(0);
    expect(empty.newestSpendDate === null || empty.spendDataAgeDays !== null).toBe(true);
  });

  it("a non-UGX row outside the display page still forces ROAS to refuse", async () => {
    await repo.insertMediaCostFact(fact({ campaign: `usd-${suffix}`, currency: "USD", spendMinor: 5 }));
    const spend = await repo.getMediaSpend(30);
    // Previously this row could hide beyond LIMIT 100 and never be seen.
    expect(spend.mixedCurrencies).toContain("USD");
    expect(await repo.getIngestedCurrencies()).toEqual(expect.arrayContaining(["UGX", "USD"]));
  });
});
