import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BADGE_CONCEPTS,
  BADGE_PREVIEW_STATES,
  DISCOUNT_GOVERNANCE_PRINCIPLES,
  FORBIDDEN_LOYALTY_CLAIMS,
  GAMIFICATION_READINESS_LEADERBOARD,
  LAUNCH_READINESS_CHECKLIST,
  LOYALTY_ADMIN_PREVIEW,
  LOYALTY_FOUNDATION_GUARDRAILS,
  LOYALTY_PROGRAMME_STATUS,
  MEMORY_LANE_CONCEPT,
  MYSTERY_REVEAL_CONCEPTS,
  QUEST_CONCEPTS,
  RISK_CONTROLS_CHECKLIST,
  TIER_PREVIEWS,
  UTILISATION_OFFER_RULES,
  UTILISATION_READINESS_SCORECARD,
  VISUAL_PROGRESS_PREVIEW,
  hasLiveFinancialMechanic,
  isLoyaltyProgrammeActive,
  loyaltyFoundationSafetySummary,
} from "../../apps/web/src/lib/loyalty-foundation";

const root = resolve(import.meta.dirname, "../..");
const publicPage = readFileSync(resolve(root, "apps/web/src/pages/loyalty.astro"), "utf8");
const adminPage = readFileSync(resolve(root, "apps/web/src/pages/admin/loyalty.astro"), "utf8");
const trustConfig = readFileSync(resolve(root, "apps/web/src/lib/admin-trust-centre.ts"), "utf8");
const moduleCard = readFileSync(resolve(root, "apps/web/src/components/admin/AdminModuleCard.astro"), "utf8");
const footer = readFileSync(resolve(root, "apps/web/src/layouts/BaseLayout.astro"), "utf8");
const sitemap = readFileSync(resolve(root, "apps/web/src/pages/sitemap.xml.ts"), "utf8");

describe("Slice 8-A programme and public truth", () => {
  it("keeps the programme inactive", () => expect(isLoyaltyProgrammeActive()).toBe(false));
  it("declares no live financial mechanic", () => expect(hasLiveFinancialMechanic()).toBe(false));
  it("does not expose customer state or persistence", () => expect(loyaltyFoundationSafetySummary()).toMatchObject({ customerState: false, persistence: false }));
  it("does not expose live offers or coupon generation", () => expect(loyaltyFoundationSafetySummary()).toMatchObject({ liveOffers: false, couponGeneration: false }));
  it("does not mutate checkout", () => expect(loyaltyFoundationSafetySummary().checkoutMutation).toBe(false));
  it("does not rank customers", () => expect(loyaltyFoundationSafetySummary().customerRanking).toBe(false));
  it("does not send customer communications", () => expect(loyaltyFoundationSafetySummary().customerCommunications).toBe(false));
  it("shows the programme-preparation truth prominently", () => expect(publicPage).toContain("GoldPlus Rewards is being prepared."));
  it("states that purchases are not earning live points", () => expect(LOYALTY_PROGRAMME_STATUS.truthMessage).toContain("not yet earning live points"));
  it("links support, terms and privacy", () => {
    expect(publicPage).toContain('href="/support"');
    expect(publicPage).toContain('href="/terms"');
    expect(publicPage).toContain('href="/privacy"');
  });
});

describe("Slice 8-A quest concepts", () => {
  it.each(QUEST_CONCEPTS)("keeps $name preview-only", (quest) => {
    expect(quest.status).toBe("Preview only");
    expect(quest.activationBlocker.length).toBeGreaterThan(15);
  });

  it("includes all ten safe quest concepts", () => expect(QUEST_CONCEPTS).toHaveLength(10));
  it("requires approved rules before a future quest benefit", () => expect(JSON.stringify(QUEST_CONCEPTS)).toMatch(/approved|policy/i));
  it("renders no quest completion or claim control", () => expect(publicPage).not.toMatch(/<button[^>]*>[^<]*(complete|claim|unlock)/i));
  // Loyalty ACTIVATION made the public page read the live programme config via
  // an SSR fetch — that is reading, not persisting. The guard keeps its intent:
  // no client-side persistence of quest progress.
  it("does not persist quest progress", () => expect(publicPage).not.toMatch(/localStorage|document\.cookie|setCookie/));
});

describe("Slice 8-A badges, tiers, progress and Memory Lane", () => {
  it("defines non-financial badge concepts", () => expect(BADGE_CONCEPTS).toContain("Device Care Champion"));
  it("keeps the earned badge state future-only", () => expect(BADGE_PREVIEW_STATES.find((state) => state.id === "future-earned")?.meaning).toContain("Would require"));
  it("keeps the undiscovered badge state future-only", () => expect(BADGE_PREVIEW_STATES.find((state) => state.id === "future-undiscovered")?.meaning).toContain("Would require"));
  it("does not make a customer earned-badge claim", () => expect(publicPage).not.toContain("You earned this badge"));
  it("keeps every tier inactive and non-customer-specific", () => expect(TIER_PREVIEWS.every((tier) => !tier.active && !tier.customerSpecific && tier.status === "Preview only")).toBe(true));
  it("labels visual progress as setup rather than customer points", () => expect(VISUAL_PROGRESS_PREVIEW.label).toContain("not customer progress"));
  it("keeps Memory Lane inactive without customer history", () => expect(MEMORY_LANE_CONCEPT.message).toContain("No customer history"));
  it("requires consent, privacy review and event history for Memory Lane", () => expect(MEMORY_LANE_CONCEPT.launchRequirements).toMatch(/consent.*event history.*privacy review/i));
});

describe("Slice 8-A utilisation-aware offer matrix", () => {
  it.each([
    "Low accessory attachment",
    "Slow-moving stock",
    "Underused benefits",
    "Quest completion",
    "Memory Lane discovery gap",
    "Reward budget utilisation",
    "Support capacity",
    "Margin floor",
  ])("includes %s without activation", (signal) => {
    const row = UTILISATION_OFFER_RULES.find((item) => item.signal === signal);
    expect(row).toBeDefined();
    expect(["Not active", "Needs approval", "Preview only"]).toContain(row?.status);
  });

  it("contains exactly the required eight planning signals", () => expect(UTILISATION_OFFER_RULES).toHaveLength(8));
  // Activation authorised the page to read the loyalty PROGRAMME config; it
  // must still never read orders, inventory or anything customer-identifying.
  it("uses no live order, inventory or customer reader", () => expect(publicPage).not.toMatch(/\/orders|\/inventory|customerId/));
  it("creates no discount or personalised price", () => expect(loyaltyFoundationSafetySummary().liveOffers).toBe(false));
  it("generates no coupon", () => expect(loyaltyFoundationSafetySummary().couponGeneration).toBe(false));
  it("keeps every scorecard row inactive or approval-gated", () => expect(UTILISATION_READINESS_SCORECARD.every((row) => ["Not active", "Needs approval", "Preview only"].includes(row.status))).toBe(true));
});

describe("Slice 8-A discount governance", () => {
  it("protects a margin floor", () => expect(DISCOUNT_GOVERNANCE_PRINCIPLES.join(" ")).toMatch(/protect margin.*margin floor/i));
  it("requires a promotion budget cap", () => expect(DISCOUNT_GOVERNANCE_PRINCIPLES.join(" ")).toMatch(/budget cap/i));
  it("puts education before discounting", () => expect(DISCOUNT_GOVERNANCE_PRINCIPLES).toContain("Education should come before discounting."));
  it("does not train customers to wait", () => expect(DISCOUNT_GOVERNANCE_PRINCIPLES.join(" ")).toContain("should not train customers to wait"));
  it("does not bypass support capacity", () => expect(DISCOUNT_GOVERNANCE_PRINCIPLES.join(" ")).toContain("should not bypass support capacity"));
  it("requires approved rules", () => expect(DISCOUNT_GOVERNANCE_PRINCIPLES.join(" ")).toContain("never apply without approved rules"));
  it("prioritises service value over price cuts", () => expect(DISCOUNT_GOVERNANCE_PRINCIPLES.join(" ")).toContain("Service value can be more powerful"));
});

describe("Slice 8-A mystery reveal safeguards", () => {
  it.each(MYSTERY_REVEAL_CONCEPTS)("keeps $name deterministic and inactive", (mechanic) => {
    expect(mechanic).toMatchObject({ status: "Preview only", prizeGenerated: false, codeIssued: false, dataCollected: false });
  });

  it("renders no random generator", () => expect(publicPage).not.toMatch(/Math\.random|crypto\.getRandomValues/));
  it("renders no scratch or spin interaction", () => expect(publicPage).not.toMatch(/canvas|wheel|pointermove|touchmove/));
  it("does not use fake urgency, gambling or spend pressure", () => expect(publicPage).not.toMatch(/limited reward|act now|jackpot|\bbet\b|wager|spend more/i));
});

describe("Slice 8-A readiness and liability controls", () => {
  it("covers the required launch-policy foundations", () => expect(LAUNCH_READINESS_CHECKLIST).toEqual(expect.arrayContaining(["Approved programme policy", "Earning rules", "Quest completion rules", "Badge award rules"])));
  it("covers Memory Lane consent and retention", () => expect(LAUNCH_READINESS_CHECKLIST).toEqual(expect.arrayContaining(["Memory Lane consent model", "Memory Lane data retention model"])));
  it("covers utilisation data, eligibility, margin and budget", () => expect(LAUNCH_READINESS_CHECKLIST).toEqual(expect.arrayContaining(["Utilisation signal data contract", "Offer eligibility rules", "Discount margin rules", "Promotion budget caps"])));
  it("covers redemption, liability, fraud, support and consent", () => expect(LAUNCH_READINESS_CHECKLIST).toEqual(expect.arrayContaining(["Redemption rules", "Financial liability model", "Fraud controls", "Support process", "Customer consent"])));
  it("covers legal, margin and reveal disclosure approval", () => expect(LAUNCH_READINESS_CHECKLIST).toEqual(expect.arrayContaining(["Legal review", "Margin approval for offers", "Odds and eligibility disclosure for reveal mechanics"])));
  it("protects order/payment, quests, badges and Memory Lane", () => expect(RISK_CONTROLS_CHECKLIST.join(" ")).toMatch(/verified order.*payment confirmation.*quest reward.*earned badge.*Memory Lane/i));
  it("protects margin, budgets, ledger and consent", () => expect(RISK_CONTROLS_CHECKLIST.join(" ")).toMatch(/margin floor.*budget cap.*balance without a ledger.*send without consent/i));
  it("contains the public financial-liability guardrails", () => expect(LOYALTY_FOUNDATION_GUARDRAILS.join(" ")).toMatch(/No live points.*No reward issuance.*No discount/i));
});

describe("Slice 8-A protected operator preview and discoverability", () => {
  it("protects the operator preview with the existing session guard", () => {
    expect(adminPage).toContain("readSessionToken(Astro.request)");
    expect(adminPage).toContain('Astro.redirect("/admin/login?returnTo=/admin/loyalty", 303)');
  });
  it("keeps the admin preview read-only and activation disabled", () => {
    expect(LOYALTY_ADMIN_PREVIEW).toMatchObject({ readOnly: true, activationStatus: "Disabled", activeFinancialMechanics: 0 });
    expect(adminPage).toContain("Activation unavailable");
    expect(adminPage).toContain("disabled");
  });
  it("ranks mechanics rather than customers", () => {
    expect(GAMIFICATION_READINESS_LEADERBOARD.map((row) => row.rank)).toEqual([...GAMIFICATION_READINESS_LEADERBOARD.keys()].map((index) => index + 1));
    expect(LOYALTY_ADMIN_PREVIEW.ranksCustomers).toBe(false);
  });
  it("contains no PII or customer leaderboard fields", () => {
    expect(LOYALTY_ADMIN_PREVIEW.containsPii).toBe(false);
    expect(JSON.stringify(GAMIFICATION_READINESS_LEADERBOARD)).not.toMatch(/email|phone|customerName|top spender|top buyer/i);
  });
  it("links the disabled trust-centre module to the read-only preview", () => {
    expect(trustConfig).toContain('previewHref: "/admin/loyalty"');
    expect(moduleCard).toContain("module.previewHref");
  });
  it("adds a public footer and sitemap route", () => {
    expect(footer).toContain('href="/loyalty"');
    expect(sitemap).toContain("'/loyalty'");
  });
  it("keeps forbidden live claims out of public and admin copy", () => {
    for (const claim of FORBIDDEN_LOYALTY_CLAIMS) {
      expect(`${publicPage}\n${adminPage}`).not.toContain(claim);
    }
  });
});
