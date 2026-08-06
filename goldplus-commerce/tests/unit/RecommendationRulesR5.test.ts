import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RecommendationRuleValidationService } from "../../apps/api/src/application/recommendations/RecommendationRuleValidationService";
import { ChangeRecommendationRuleStatusUseCase } from "../../apps/api/src/application/recommendations/ChangeRecommendationRuleStatusUseCase";
import { RollbackRecommendationRuleUseCase } from "../../apps/api/src/application/recommendations/RollbackRecommendationRuleUseCase";
import type { RecommendationRule } from "../../apps/api/src/domain/recommendations/RecommendationRuleTypes";

/**
 * R5 (2026-08-06): rules and preview become operator-grade. These pins hold
 * the governance closed: the lifecycle matrix, the two-person suppression
 * gate, the honest refusal of dead config, and rollback from the audit trail.
 */

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const validator = new RecommendationRuleValidationService();

const baseRule = (over: Partial<RecommendationRule> = {}): Partial<RecommendationRule> => ({
  name: "Promote power banks",
  type: "BOOST",
  status: "DRAFT",
  placement: "home_trending",
  targetType: "PRODUCT",
  targetValue: "27b396dd-55c1-4181-9772-aec1bf4a3dcf",
  priority: 100,
  action: { type: "BOOST", boostScore: 25 },
  ...over,
});

describe("the validator refuses dangerous and dead configuration", () => {
  it("a GLOBAL SUPPRESS is refused — an outage cannot be authored through a form", () => {
    const errors = validator.validate(baseRule({ type: "SUPPRESS", targetType: "GLOBAL", targetValue: undefined, action: { type: "SUPPRESS" } }));
    expect(errors.join(" ")).toContain("empty the placement");
  });

  it("non-empty conditions are refused, not accepted-and-ignored", () => {
    // The engine has never evaluated `conditions`; silently accepting them is
    // the recorded authored-but-unapplied trap.
    const errors = validator.validate(baseRule({ conditions: { priceBand: "low" } as never }));
    expect(errors.join(" ")).toContain("not evaluated by the engine");
    expect(validator.validate(baseRule({ conditions: {} }))).toEqual([]);
  });
});

function fakeRepos(existing: Partial<RecommendationRule>) {
  const audits: Array<{ action: string }> = [];
  const statusChanges: string[] = [];
  const ruleRepo = {
    async findById() {
      return existing as RecommendationRule;
    },
    async changeStatus(_id: string, status: string) {
      statusChanges.push(status);
    },
    async update(_id: string, patch: RecommendationRule) {
      return patch;
    },
  };
  const auditRepo = {
    async record(e: { action: string }) {
      audits.push(e);
    },
    async findByRuleId() {
      return [] as never[];
    },
  };
  return { ruleRepo, auditRepo, audits, statusChanges };
}

describe("the lifecycle matrix — no state is unreachable, none resurrects", () => {
  const attempt = async (from: string, to: string, over: Partial<RecommendationRule> = {}) => {
    const { ruleRepo, auditRepo } = fakeRepos({ id: "r1", type: "BOOST", status: from as never, ...over });
    const useCase = new ChangeRecommendationRuleStatusUseCase(ruleRepo as never, auditRepo as never);
    return useCase.execute({ id: "r1", status: to as never, performedBy: "admin-2" });
  };

  it("PAUSED is finally reachable, and a paused rule can resume", async () => {
    expect((await attempt("ACTIVE", "PAUSED")).ok).toBe(true);
    expect((await attempt("PAUSED", "ACTIVE")).ok).toBe(true);
  });

  it("ARCHIVED is terminal and DRAFT cannot skip to PAUSED", async () => {
    expect((await attempt("ARCHIVED", "ACTIVE")).ok).toBe(false);
    expect((await attempt("DRAFT", "PAUSED")).ok).toBe(false);
  });
});

describe("two-person suppression (mirrors SOD-1)", () => {
  it("the author cannot activate their own SUPPRESS rule; a second admin can", async () => {
    const rule = { id: "r1", type: "SUPPRESS", status: "DRAFT", createdBy: "admin-1" };
    const { ruleRepo, auditRepo } = fakeRepos(rule as never);
    const useCase = new ChangeRecommendationRuleStatusUseCase(ruleRepo as never, auditRepo as never);

    const self = await useCase.execute({ id: "r1", status: "ACTIVE", performedBy: "admin-1" });
    expect(self.ok).toBe(false);
    expect(self.message).toContain("different admin");

    const second = await useCase.execute({ id: "r1", status: "ACTIVE", performedBy: "admin-2" });
    expect(second.ok).toBe(true);
  });

  it("the creation path cannot smuggle a SUPPRESS rule in as ACTIVE", () => {
    const src = read("apps/api/src/application/recommendations/CreateRecommendationRuleUseCase.ts");
    expect(src).toContain('pendingRule.type === "SUPPRESS" && pendingRule.status === "ACTIVE"');
  });

  it("a PUT cannot smuggle a status change around the matrix", () => {
    const src = read("apps/api/src/application/recommendations/UpdateRecommendationRuleUseCase.ts");
    expect(src).toContain("updates.status !== undefined && updates.status !== existing.status");
  });
});

describe("priority finally means something within a type", () => {
  it("each rule partition is sorted by priority before application", () => {
    const src = read("apps/api/src/application/recommendations/RecommendationRuleApplicationService.ts");
    expect(src.match(/\.sort\(byPriority\)/g)?.length).toBe(3);
  });
});

describe("rollback restores from the audit trail (AC32)", () => {
  const existing: Partial<RecommendationRule> = {
    id: "r1",
    name: "Current name",
    type: "BOOST",
    status: "ACTIVE",
    placement: "home_trending",
    targetType: "PRODUCT",
    targetValue: "27b396dd-55c1-4181-9772-aec1bf4a3dcf",
    priority: 5,
    action: { type: "BOOST", boostScore: 90 },
    createdBy: "admin-1",
    createdAt: new Date("2026-08-01"),
  };

  function rollbackSetup(auditEntries: Array<{ id: string; before?: unknown }>) {
    const { ruleRepo, auditRepo, audits } = fakeRepos(existing);
    (auditRepo as { findByRuleId: () => Promise<unknown[]> }).findByRuleId = async () => auditEntries;
    const useCase = new RollbackRecommendationRuleUseCase(
      ruleRepo as never,
      auditRepo as never,
      new RecommendationRuleValidationService(),
    );
    return { useCase, audits };
  }

  it("restores the before-image, keeps identity/lifecycle, and audits itself as ROLLED_BACK", async () => {
    const { useCase, audits } = rollbackSetup([
      { id: "a1", before: { name: "Original name", action: { type: "BOOST", boostScore: 20 }, priority: 100 } },
    ]);
    const result = await useCase.execute({ ruleId: "r1", auditLogId: "a1", performedBy: "admin-2" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rule.name).toBe("Original name");
      expect(result.rule.action.boostScore).toBe(20);
      // Lifecycle and provenance are NOT restored — the status use case owns them.
      expect(result.rule.status).toBe("ACTIVE");
      expect(result.rule.createdBy).toBe("admin-1");
    }
    expect(audits.map((a) => a.action)).toContain("ROLLED_BACK");
  });

  it("refuses an entry with no before-image instead of writing garbage", async () => {
    const { useCase } = rollbackSetup([{ id: "a1", before: null }]);
    const result = await useCase.execute({ ruleId: "r1", auditLogId: "a1", performedBy: "admin-2" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("NO_BEFORE_IMAGE");
  });
});

describe("the admin pages stopped leaking", () => {
  it("no admin recommendation page serializes the session token or an api origin into HTML", () => {
    for (const page of [
      "apps/web/src/pages/admin/recommendations/rules/new.astro",
      "apps/web/src/pages/admin/recommendations/rules/[id].astro",
      "apps/web/src/pages/admin/recommendations/preview.astro",
    ]) {
      const src = read(page);
      expect(src, page).not.toContain('id="session-token"');
      expect(src, page).not.toContain('id="api-base-url"');
    }
  });

  it("the wizard and preview are selector-driven — no raw UUID inputs (AC25/AC26)", () => {
    for (const page of [
      "apps/web/src/pages/admin/recommendations/rules/new.astro",
      "apps/web/src/pages/admin/recommendations/preview.astro",
    ]) {
      const src = read(page);
      expect(src, page).not.toContain("00000000-0000-0000");
      expect(src, page).toContain("products.map((p) => <option value={p.id}");
    }
  });
});
