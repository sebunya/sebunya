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
    expect(hero).toContain("isAutomaticExposureEvent(String(body.eventType ?? '')) ? 'read' : 'behaviour'");
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
    expect(hero).toContain("pgInTextList(sql`e.event_type`, VISITOR_ACTION_EVENT_TYPES)");
    expect(hero).not.toContain("interval '180 days'");
  });

  it("personalisation is kept forever: no profile prune, a sliding 400-day cookie", () => {
    const mat = read("apps/api/src/infrastructure/scheduler/RecommendationMaterializer.ts");
    expect(mat).not.toContain("delete from experience_profiles");
    const mw = read("apps/web/src/middleware.ts");
    expect(mw).toContain("VISIT_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60");
    expect(mw).toContain("if (firstDocumentToday) context.cookies.set(VISIT_COOKIE_NAME, existing, visitCookieOptions());");
  });

  it("a signed-in customer's history follows them to a new device", () => {
    const hero = read("apps/api/src/infrastructure/hero/HeroSignalsService.ts");
    expect(hero.match(/join experience_profiles sib on sib\.customer_id = me\.customer_id/g)?.length).toBe(2);
    expect(hero).toContain("select min(sib.first_seen_at) from experience_profiles sib");
  });

  it("automatic exposure beacons never create a profile; visitor actions do (found live on 2026-09-20)", async () => {
    const { isAutomaticExposureEvent } = await import("../../packages/shared/src/recommendations");
    for (const t of ["IMPRESSION", "NBA_IMPRESSION", "SEARCH_SUGGEST_SHOWN", "SEARCH_ZERO", "RECOMMENDATION_IMPRESSION", "RECOMMENDATION_VIEWED"]) expect(isAutomaticExposureEvent(t), t).toBe(true);
    for (const t of ["CLICK", "PANEL_OPEN", "NBA_CLICK", "SEARCH_SUBMIT", "PRODUCT_VIEWED", "PRODUCT_ADDED_TO_CART"]) expect(isAutomaticExposureEvent(t), t).toBe(false);
    for (const f of ["hero", "nav"]) expect(read(`apps/api/src/interfaces/http/routes/${f}.ts`)).toContain("isAutomaticExposureEvent(String(body.eventType ?? '')) ? 'read' : 'behaviour'");
    expect(read("apps/api/src/interfaces/http/routes/recommendations.ts")).toContain("exposure ? 'read' : 'behaviour'");
  });
});
