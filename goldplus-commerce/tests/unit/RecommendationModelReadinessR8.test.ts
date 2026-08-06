import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  RecommendationModelReadinessUseCase,
  computeSrm,
} from "../../apps/api/src/application/recommendations/RecommendationModelReadiness";
import { AssignRecommendationExperimentUseCase } from "../../apps/api/src/application/recommendations/AssignRecommendationExperimentUseCase";

/**
 * R8 (2026-08-06): model readiness, the experiment seam and shadow discipline.
 * The load-bearing claims: no learned model without numeric evidence (AC40),
 * assignment is server-side and deterministic (AC42/AC53), SRM is detectable
 * with a minimum sample (AC43), and nothing about an experiment can empty or
 * alter serving when none is RUNNING.
 */

const ROOT = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function readinessFixture(over: {
  contractV2?: number;
  paidUnits?: number;
  products?: number;
  responses?: number;
  orphanClicks?: number;
  profileStamped?: number;
  experiments?: Array<{
    id: string;
    key: string;
    status: string;
    createdAt: Date;
    variants: Array<{ key: string; name: string; weightBasisPoints: number }>;
  }>;
  byVariant?: Record<string, number>;
} = {}) {
  const analytics = {
    async getLineageReport() {
      return {
        windowDays: 90,
        total: over.contractV2 ?? 100,
        historicPreContract: 0,
        contractV2: over.contractV2 ?? 100,
        identityUnavailable: 0,
        railEventsMissingPlacement: 0,
        orphanClicks: over.orphanClicks ?? 0,
        attributedAtcWithoutExposure: 0,
        profileStamped: over.profileStamped ?? 0,
      };
    },
    async getServingHealth() {
      return { windowDays: 30, placements: [], totalResponses: over.responses ?? 0 };
    },
  };
  const products = {
    async findPublicProducts() {
      return Array.from({ length: over.products ?? 8 }, (_, i) => ({ id: `p${i}`, slug: `p${i}`, name: `P${i}` }));
    },
    async findBestsellerProductIds() {
      return over.paidUnits ? [{ productId: "p1", unitsSold: over.paidUnits }] : [];
    },
  };
  const experiments = {
    async list() {
      return over.experiments ?? [];
    },
    async counts() {
      return { assignments: 0, exposures: 0, byVariant: over.byVariant ?? {} };
    },
  };
  return new RecommendationModelReadinessUseCase(analytics as never, products as never, experiments as never);
}

describe("AC39/AC40 — the stage is explicit and evidence-gated", () => {
  it("today's production shape reads DETERMINISTIC_POLICY with every blocking gate named and numbered", async () => {
    const result = await readinessFixture().execute();
    expect(result.stage).toBe("DETERMINISTIC_POLICY");
    expect(result.policyVersion).toBe("det-v3");
    expect(result.blockedBy.length).toBeGreaterThan(0);
    for (const gate of result.gates) {
      expect(typeof gate.required).toBe("number");
      expect(typeof gate.actual).toBe("number");
    }
  });

  it("even with every gate met, the next stage is SHADOW ONLY — never straight to serving", async () => {
    const result = await readinessFixture({
      contractV2: 20_000,
      paidUnits: 1_000,
      products: 100,
      responses: 5_000,
      orphanClicks: 0,
      profileStamped: 19_000,
    }).execute();
    expect(result.stage).toBe("LEARNED_RANKER_SHADOW_ONLY");
    expect(result.blockedBy).toEqual([]);
  });
});

describe("AC43 — sample-ratio mismatch is detectable, with a minimum sample", () => {
  const variants = [
    { key: "control", weightBp: 5000 },
    { key: "treatment", weightBp: 5000 },
  ];

  it("a clean 50/50 split raises nothing", () => {
    const srm = computeSrm(variants, { control: 510, treatment: 490 });
    expect(srm.srmSuspected).toBe(false);
  });

  it("a broken split is flagged beyond chance", () => {
    const srm = computeSrm(variants, { control: 700, treatment: 300 });
    expect(srm.srmSuspected).toBe(true);
    expect(srm.chiSquare).toBeGreaterThan(6.635);
  });

  it("below the minimum sample there is NO verdict — noise is not vigilance", () => {
    const srm = computeSrm(variants, { control: 30, treatment: 5 });
    expect(srm.srmSuspected).toBe(false);
    expect(srm.chiSquare).toBeNull();
    expect(srm.note).toContain("minimum");
  });
});

describe("AC42/AC53 — assignment is server-side, stable, and absent without a profile or a RUNNING experiment", () => {
  function assigner(experiments: Array<{ id: string; key: string; status: string; createdAt: Date }>) {
    const calls: Array<{ id: string; subjectKey: string }> = [];
    const repo = { async list() { return experiments; } };
    const ops = {
      async assignAndExpose(input: { id: string; subjectKey: string }) {
        calls.push(input);
        return { assignment: { variantKey: "control" } };
      },
    };
    return { useCase: new AssignRecommendationExperimentUseCase(repo as never, ops as never), calls };
  }

  it("no RUNNING rec_ experiment → null, and the canonical machinery is never touched", async () => {
    const { useCase, calls } = assigner([
      { id: "e1", key: "rec_test", status: "DRAFT", createdAt: new Date("2026-08-01") },
      { id: "e2", key: "checkout_x", status: "RUNNING", createdAt: new Date("2026-08-01") },
    ]);
    expect(await useCase.execute("profile-1")).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("with several RUNNING rec_ experiments, the OLDEST wins — overlap would confound both", async () => {
    const { useCase, calls } = assigner([
      { id: "newer", key: "rec_b", status: "RUNNING", createdAt: new Date("2026-08-05") },
      { id: "older", key: "rec_a", status: "RUNNING", createdAt: new Date("2026-08-01") },
    ]);
    const result = await useCase.execute("profile-1");
    expect(result).toEqual({ experimentKey: "rec_a", variantKey: "control" });
    expect(calls[0].id).toBe("older");
    expect(calls[0].subjectKey).toBe("profile-1");
  });

  it("assignment failure returns null — serving never blocks on an experiment", async () => {
    const repo = { async list() { throw new Error("db down"); } };
    const useCase = new AssignRecommendationExperimentUseCase(repo as never, {} as never);
    expect(await useCase.execute("profile-1")).toBeNull();
  });

  it("the route assigns only with a profile, and the variant travels in server meta only", () => {
    const route = read("apps/api/src/interfaces/http/routes/recommendations.ts");
    expect(route).toContain("profileId\n      ? await registry.assignRecommendationExperimentUseCase.execute(profileId)");
    // The client input can never carry a variant choice.
    const shared = read("packages/shared/src/recommendations.ts");
    expect(shared.slice(shared.indexOf("GetRecommendationsInput"))).not.toContain("variant");
  });
});

describe("AC41 — nothing shadow-shaped can touch the serving path", () => {
  it("the engine has no learned-model or shadow dependency; its strategy is the deterministic policy", () => {
    const engine = read("apps/api/src/application/recommendations/GetRecommendationsUseCase.ts");
    expect(engine).not.toMatch(/shadow|learned|ml_rank/i);
    expect(engine).toContain('strategy: "deterministic_v3"');
  });

  it("the readiness endpoint is read-only and behind recommendations.read", () => {
    const routes = read("apps/api/src/interfaces/http/routes/admin/recommendations.ts");
    expect(routes).toContain('routes.get("/model/readiness", requirePermissions([PERMISSIONS.RECOMMENDATIONS_READ])');
  });
});
