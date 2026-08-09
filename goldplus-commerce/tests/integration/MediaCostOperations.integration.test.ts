import { afterAll, beforeAll, describe, expect, it } from "vitest";
import crypto from "node:crypto";

/**
 * Media-cost operations (0102 + R4) against REAL PostgreSQL.
 *
 * The properties proven here are the ones ROAS depends on being true:
 * a replayed spend fact is counted, never doubled (the logical-key unique
 * index, AC17); a correction returns the previous figure for the audit and
 * changes only the amounts (AC18); and the operator summary reports freshness
 * from the data alone (a feed that stopped is not a feed of zero).
 */

const URL = process.env.COMMERCE_TEST_DATABASE_URL;
const suite = URL && process.env.DATABASE_URL ? describe : describe.skip;

suite("media cost operations on real PostgreSQL", () => {
  let pg: typeof import("../../apps/api/src/infrastructure/db/client").client;
  let repo: import("../../apps/api/src/infrastructure/db/repositories/DrizzleRecommendationCommercialRepository").DrizzleRecommendationCommercialRepository;

  const suffix = crypto.randomBytes(5).toString("hex");
  const operator = crypto.randomUUID();
  const campaign = `IT Campaign ${suffix}`;
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  const fact = (over: Record<string, unknown> = {}) => ({
    spendDate: yesterday,
    channel: "paid_social",
    platform: "Meta",
    account: `acct-${suffix}`,
    campaign,
    adSetOrGroup: null,
    adOrCreative: null,
    currency: "UGX",
    spendMinor: 250_000,
    taxOrFeeMinor: 0,
    source: `it-${suffix}`,
    sourceReference: null,
    ingestedBy: operator,
    ...over,
  });

  beforeAll(async () => {
    ({ client: pg } = await import("../../apps/api/src/infrastructure/db/client"));
    const { applyRecommendationMigrations } = await import("./helpers/applyRecommendationMigrations");
    await applyRecommendationMigrations(pg);
    const { DrizzleRecommendationCommercialRepository } = await import(
      "../../apps/api/src/infrastructure/db/repositories/DrizzleRecommendationCommercialRepository"
    );
    repo = new DrizzleRecommendationCommercialRepository();
  });

  afterAll(async () => {
    await pg`delete from media_cost_facts where account = ${`acct-${suffix}`}`;
  });

  it("inserts a spend fact once; the exact replay is a duplicate, never a double (AC17)", async () => {
    const first = await repo.insertMediaCostFact(fact());
    expect(first.inserted).toBe(true);

    const replay = await repo.insertMediaCostFact(fact());
    expect(replay.inserted).toBe(false);

    const [row] = await pg`
      select count(*)::int as n, coalesce(sum(spend_minor), 0)::bigint as spend
      from media_cost_facts where account = ${`acct-${suffix}`}`;
    expect(row.n).toBe(1);
    expect(Number(row.spend)).toBe(250_000); // replay did not double the denominator
  });

  it("a DIFFERENT source for the same campaign-day is a distinct fact, honestly kept apart", async () => {
    const other = await repo.insertMediaCostFact(fact({ source: `it2-${suffix}` }));
    expect(other.inserted).toBe(true);
  });

  it("correction returns the PREVIOUS figure for the audit and changes only the amounts (AC18)", async () => {
    const result = await repo.correctMediaCostFact({
      spendDate: yesterday,
      channel: "paid_social",
      platform: "Meta",
      account: `acct-${suffix}`,
      campaign,
      adSetOrGroup: null,
      adOrCreative: null,
      source: `it-${suffix}`,
      spendMinor: 300_000,
      taxOrFeeMinor: 54_000,
    });
    expect(result.corrected).toBe(true);
    expect(result.previous).toEqual({ spendMinor: 250_000, taxOrFeeMinor: 0 });

    const [row] = await pg`
      select spend_minor, tax_or_fee_minor from media_cost_facts
      where account = ${`acct-${suffix}`} and source = ${`it-${suffix}`}`;
    expect(Number(row.spend_minor)).toBe(300_000);
    expect(Number(row.tax_or_fee_minor)).toBe(54_000);
  });

  it("correcting a fact that was never ingested corrects NOTHING — no upsert by stealth", async () => {
    const result = await repo.correctMediaCostFact({
      spendDate: yesterday,
      channel: "paid_social",
      platform: "Meta",
      account: `acct-${suffix}`,
      campaign: "No Such Campaign",
      adSetOrGroup: null,
      adOrCreative: null,
      source: `it-${suffix}`,
      spendMinor: 1,
      taxOrFeeMinor: 0,
    });
    expect(result.corrected).toBe(false);
    expect(result.previous).toBeNull();
  });

  it("the operator summary reports freshness and the ingested facts (R4)", async () => {
    const summary = await repo.getMediaCostOpsSummary(200);
    expect(summary.totalFacts).toBeGreaterThanOrEqual(2);
    expect(summary.currencies).toContain("UGX");
    expect(summary.newestSpendDate).not.toBeNull();
    expect(summary.spendDataAgeDays).not.toBeNull();
    expect(summary.spendDataAgeDays!).toBeGreaterThanOrEqual(0);

    const mine = summary.recentFacts.filter((f) => f.account === `acct-${suffix}`);
    expect(mine.length).toBe(2);
    const corrected = mine.find((f) => f.source === `it-${suffix}`);
    expect(corrected).toMatchObject({ campaign, spendMinor: 300_000, taxOrFeeMinor: 54_000, currency: "UGX" });
  });

  it("the summary is bounded — a huge limit is clamped, not passed through", async () => {
    const summary = await repo.getMediaCostOpsSummary(1_000_000);
    expect(summary.recentFacts.length).toBeLessThanOrEqual(200);
  });
});
