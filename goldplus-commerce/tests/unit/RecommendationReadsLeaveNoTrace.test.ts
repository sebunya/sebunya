import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(p, "utf8");

describe("recommendation reads leave no trace (personalisation rebuild, R0)", () => {
  it("the middleware never exposes a token minted on this request as an identity", () => {
    const src = read("apps/web/src/middleware.ts");
    const mint = src.slice(src.indexOf("const token = mintSignedVisitToken();"));
    const block = mint.slice(0, mint.indexOf("gpVisitIsNew = true"));
    // The only assignment allowed is the one behind the rollback switch.
    const assignments = block.match(/context\.locals\.gpVisit = token/g) ?? [];
    expect(assignments.length).toBe(1);
    expect(block).toContain("process.env.SSR_IDENTITY_V2 === 'false'");
  });

  it("GET routes resolve with read intent; only behavioural POSTs may create", () => {
    const rec = read("apps/api/src/interfaces/http/routes/recommendations.ts");
    const getCall = rec.slice(rec.indexOf("const rawVisitToken = c.req.header('x-gp-visit')"));
    expect(getCall.slice(0, 400)).toContain("resolveExperienceProfileUseCase.execute(rawVisitToken))");
    const hero = read("apps/api/src/interfaces/http/routes/hero.ts");
    expect(hero.match(/profileFrom\(c, 'behaviour'\)/g)?.length).toBe(1);
    expect(hero).toContain("intent: 'read' | 'behaviour' = 'read'");
  });

  it("a rendered rail is counted, not stored as customer behaviour", () => {
    const uc = read("apps/api/src/application/recommendations/GetRecommendationsUseCase.ts");
    const stage = uc.slice(uc.indexOf("serverContext?.emitResponseEvent && this.servingStats"));
    expect(stage.indexOf("this.servingStats.record")).toBeLessThan(stage.indexOf("this.emitResponseEvent("));
    expect(stage).toContain("} else if (serverContext?.emitResponseEvent && this.events)");
  });

  it("visit strength counts what the visitor did, not what we rendered", () => {
    const hero = read("apps/api/src/infrastructure/hero/HeroSignalsService.ts");
    expect(hero).toContain("e.event_type = any(${pgTextArray(VISITOR_ACTION_EVENT_TYPES)})");
    expect(hero).not.toContain("interval '180 days'");
  });

  it("personalisation is kept forever: no profile prune, a sliding 400-day cookie", () => {
    const mat = read("apps/api/src/infrastructure/scheduler/RecommendationMaterializer.ts");
    expect(mat).not.toContain("delete from experience_profiles");
    const mw = read("apps/web/src/middleware.ts");
    expect(mw).toContain("VISIT_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60");
    expect(mw).toContain("if (firstDocumentToday) context.cookies.set(VISIT_COOKIE_NAME, existing, visitCookieOptions());");
  });
});
