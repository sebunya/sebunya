import { Hono } from "hono";
import { authMiddleware } from "../../middleware/auth";
import { requirePermissions } from "../../middleware/permissions";
import { Registry } from "../../../../infrastructure/Registry";
import { ApiResponse, PERMISSIONS } from "@goldplus/shared";

// Use Case Imports
import { ListRecommendationRulesUseCase } from "../../../../application/recommendations/ListRecommendationRulesUseCase";
import { CreateRecommendationRuleUseCase } from "../../../../application/recommendations/CreateRecommendationRuleUseCase";
import { UpdateRecommendationRuleUseCase } from "../../../../application/recommendations/UpdateRecommendationRuleUseCase";
import { ChangeRecommendationRuleStatusUseCase } from "../../../../application/recommendations/ChangeRecommendationRuleStatusUseCase";
import { ArchiveRecommendationRuleUseCase } from "../../../../application/recommendations/ArchiveRecommendationRuleUseCase";
import { GetRecommendationRuleUseCase } from "../../../../application/recommendations/GetRecommendationRuleUseCase";
import { GetRecommendationRuleAuditLogUseCase } from "../../../../application/recommendations/GetRecommendationRuleAuditLogUseCase";
import { PreviewRecommendationRulesUseCase } from "../../../../application/recommendations/PreviewRecommendationRulesUseCase";
import { RollbackRecommendationRuleUseCase } from "../../../../application/recommendations/RollbackRecommendationRuleUseCase";

import { RecommendationRuleValidationService } from "../../../../application/recommendations/RecommendationRuleValidationService";
import { RecommendationRuleConflictService } from "../../../../application/recommendations/RecommendationRuleConflictService";

// Local interfaces
import { RecommendationRuleStatus } from "../../../../domain/recommendations/RecommendationRuleTypes";

type AdminContextVars = {
  user: { id: string; email: string; permissions: string[] };
};

const routes = new Hono<{ Variables: AdminContextVars }>();

// audit-exempt: Pass 12C specifies using IRecommendationRuleAuditRepository dedicated domain audit stream instead of generic global audit.
routes.use("*", authMiddleware);

// R1 (2026-08-06): the "Temporary RBAC compromise" (blanket SETTINGS_MANAGE) is
// retired. Reads — rule listing, audit history, analytics, and the dry-run
// preview, which persists nothing — require recommendations.read; every
// mutation requires recommendations.manage. Both grants were provisioned in
// the shared registry long ago and are held by Owner and
// PLATFORM_ADMINISTRATOR in production (verified before the switch).
// (Inlined per route rather than aliased so the AuthorizationCoverage scan
// sees the guard at every handler site.)

// 1. LIST RULES
routes.get("/rules", requirePermissions([PERMISSIONS.RECOMMENDATIONS_READ]), async (c) => {
  const registry = Registry.getInstance();
  const uc = new ListRecommendationRulesUseCase(registry.recommendationRuleRepo);

  const page = c.req.query("page") ? parseInt(c.req.query("page")!, 10) : 1;
  const pageSize = c.req.query("pageSize") ? parseInt(c.req.query("pageSize")!, 10) : 20;

  const result = await uc.execute({
    placement: c.req.query("placement") as any,
    type: c.req.query("type") as any,
    status: c.req.query("status") as any,
    targetType: c.req.query("targetType") as any,
    targetValue: c.req.query("targetValue"),
    search: c.req.query("search"),
    page,
    pageSize,
  });

  const res: ApiResponse<typeof result> = { success: true, data: result };
  return c.json(res);
});

// 2. CREATE RULE
routes.post("/rules", requirePermissions([PERMISSIONS.RECOMMENDATIONS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid body" } }, 400);

  const registry = Registry.getInstance();
  // Note: RecommendationRuleValidationService/ConflictService are already existing & safe for route instantiate
  // We get existing singleton instances if injected, or create lightweight local one just like UseCases.
  // The registry doesn't manage validator Singletons, so creating is lightweight and standard here.
  const uc = new CreateRecommendationRuleUseCase(
    registry.recommendationRuleRepo,
    registry.recommendationRuleAuditRepo,
    new RecommendationRuleValidationService(),
    new RecommendationRuleConflictService(),
  );

  const actorId = c.get("user").id;
  const result = await uc.execute({ rule: body, performedBy: actorId });

  if (!result.ok) {
    if (result.code === "VALIDATION_FAILED") {
      return c.json({ success: false, error: { code: "RECOMMENDATION_RULE_VALIDATION_FAILED", message: "Validation failed.", details: result.errors } }, 400);
    }
    if (result.code === "CONFLICT_DETECTED") {
      return c.json({ success: false, error: { code: "RECOMMENDATION_RULE_CONFLICT", message: result.message, details: result.details } }, 409);
    }
  }

  return c.json({ success: true, data: (result as any).rule }, 201);
});

// 3. GET RULE BY ID
routes.get("/rules/:id", requirePermissions([PERMISSIONS.RECOMMENDATIONS_READ]), async (c) => {
  const id = c.req.param("id") as string;
  const registry = Registry.getInstance();
  const uc = new GetRecommendationRuleUseCase(registry.recommendationRuleRepo);
  
  const rule = await uc.execute(id);
  if (!rule) {
    return c.json({ success: false, error: { code: "RECOMMENDATION_RULE_NOT_FOUND", message: "Recommendation rule not found." } }, 404);
  }

  return c.json({ success: true, data: rule });
});

// 4. UPDATE RULE
routes.put("/rules/:id", requirePermissions([PERMISSIONS.RECOMMENDATIONS_MANAGE]), async (c) => {
  const id = c.req.param("id") as string;
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid body" } }, 400);

  const registry = Registry.getInstance();
  const uc = new UpdateRecommendationRuleUseCase(
    registry.recommendationRuleRepo,
    registry.recommendationRuleAuditRepo,
    new RecommendationRuleValidationService(),
    new RecommendationRuleConflictService(),
  );

  const actorId = c.get("user").id;
  const result = await uc.execute({ id, updates: body, performedBy: actorId });

  if (!result.ok) {
    if (result.code === "NOT_FOUND") return c.json({ success: false, error: { code: "RECOMMENDATION_RULE_NOT_FOUND", message: result.message } }, 404);
    if (result.code === "VALIDATION_FAILED") return c.json({ success: false, error: { code: "RECOMMENDATION_RULE_VALIDATION_FAILED", message: "Validation failed.", details: result.errors } }, 400);
    if (result.code === "CONFLICT_DETECTED") return c.json({ success: false, error: { code: "RECOMMENDATION_RULE_CONFLICT", message: result.message, details: result.details } }, 409);
  }

  return c.json({ success: true, data: (result as any).rule });
});

// 5. CHANGE STATUS
routes.post("/rules/:id/status", requirePermissions([PERMISSIONS.RECOMMENDATIONS_MANAGE]), async (c) => {
  const id = c.req.param("id") as string;
  const body = await c.req.json().catch(() => null);
  if (!body || !body.status) return c.json({ success: false, error: { code: "INVALID_INPUT", message: "Status required." } }, 400);

  const registry = Registry.getInstance();
  const uc = new ChangeRecommendationRuleStatusUseCase(registry.recommendationRuleRepo, registry.recommendationRuleAuditRepo);
  
  const result = await uc.execute({ id, status: body.status as RecommendationRuleStatus, performedBy: c.get("user").id });
  if (!result.ok) {
    return c.json({ success: false, error: { code: "RECOMMENDATION_RULE_NOT_FOUND", message: result.message } }, 404);
  }

  return c.json({ success: true, data: result.rule });
});

// 6. ARCHIVE RULE
routes.post("/rules/:id/archive", requirePermissions([PERMISSIONS.RECOMMENDATIONS_MANAGE]), async (c) => {
  const id = c.req.param("id") as string;
  const registry = Registry.getInstance();
  const uc = new ArchiveRecommendationRuleUseCase(registry.recommendationRuleRepo, registry.recommendationRuleAuditRepo);

  const result = await uc.execute(id, c.get("user").id);
  if (!result.ok) {
    return c.json({ success: false, error: { code: "RECOMMENDATION_RULE_NOT_FOUND", message: result.message } }, 404);
  }

  return c.json({ success: true, data: { message: "Archived successfully" } });
});

// 6b. ROLLBACK TO A PRIOR VERSION (R5, AC32)
routes.post("/rules/:id/rollback/:auditId", requirePermissions([PERMISSIONS.RECOMMENDATIONS_MANAGE]), async (c) => {
  const registry = Registry.getInstance();
  const uc = new RollbackRecommendationRuleUseCase(
    registry.recommendationRuleRepo,
    registry.recommendationRuleAuditRepo,
    new RecommendationRuleValidationService(),
  );
  const result = await uc.execute({
    ruleId: c.req.param("id") as string,
    auditLogId: c.req.param("auditId") as string,
    performedBy: c.get("user").id,
  });
  if (!result.ok) {
    const status = result.code === "VALIDATION_FAILED" ? 400 : 404;
    return c.json({ success: false, error: { code: `ROLLBACK_${result.code}`, message: "Rollback refused.", details: result.errors } }, status);
  }
  return c.json({ success: true, data: result.rule });
});

// 7. GET AUDIT LOG
routes.get("/rules/:id/audit-log", requirePermissions([PERMISSIONS.RECOMMENDATIONS_READ]), async (c) => {
  const id = c.req.param("id") as string;
  const registry = Registry.getInstance();
  const uc = new GetRecommendationRuleAuditLogUseCase(registry.recommendationRuleAuditRepo);
  
  const items = await uc.execute(id);
  return c.json({ success: true, data: { items } });
});

// 8. PREVIEW SIMULATION
routes.post("/preview", requirePermissions([PERMISSIONS.RECOMMENDATIONS_READ]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || !body.placement) return c.json({ success: false, error: { code: "INVALID_INPUT", message: "Placement required in body for preview." } }, 400);

  const registry = Registry.getInstance();
  
  // Re-instantiate components properly via Registry getters or lightweight local mapping
  // To properly create PreviewUseCase, it needs dependencies mapped from the central registry singleton
  const uc = new PreviewRecommendationRulesUseCase(
    registry.recommendationRuleRepo,
    registry.getRecommendationsUseCase, 
    registry.recommendationRuleApplicationService, 
    new RecommendationRuleValidationService(),
    registry.recommendationDedupe, 
    registry.recommendationDiversity 
  );

  const result = await uc.execute({
    placement: body.placement,
    productId: body.productId,
    categoryId: body.categoryId,
    categorySlug: body.categorySlug,
    cartProductIds: body.cartProductIds,
    limit: body.limit,
    draftRule: body.draftRule,
    draftOnly: body.draftOnly,
  });

  if (!result.ok) {
    if (result.code === "VALIDATION_FAILED") {
       return c.json({ success: false, error: { code: "RECOMMENDATION_RULE_VALIDATION_FAILED", message: "Draft rule failed validation.", details: (result as any).errors } }, 400);
    }
  }

  return c.json({ success: true, data: result.data });
});

// 9. ANALYTICS

// §19 depth metrics — raw counts always; percentages only with safe denominators.
routes.get("/analytics/depth", requirePermissions([PERMISSIONS.RECOMMENDATIONS_READ]), async (c) => {
  const windowDays = Math.min(90, Math.max(1, Number(c.req.query("windowDays")) || 30));
  const result = await Registry.getInstance().recommendationAnalyticsService.getDepthMetrics(windowDays);
  const res: ApiResponse<typeof result> = { success: true, data: result };
  return c.json(res);
});

// R6: serving truth per placement — from the engine's own response events.
routes.get("/analytics/serving", requirePermissions([PERMISSIONS.RECOMMENDATIONS_READ]), async (c) => {
  const windowDays = Math.min(90, Math.max(1, Number(c.req.query("windowDays")) || 7));
  const result = await Registry.getInstance().recommendationAnalyticsService.getServingHealth(windowDays);
  const res: ApiResponse<typeof result> = { success: true, data: result };
  return c.json(res);
});

// R4: lineage/data-quality — a data problem rendered distinctly from an engine problem.
routes.get("/analytics/lineage", requirePermissions([PERMISSIONS.RECOMMENDATIONS_READ]), async (c) => {
  const windowDays = Math.min(90, Math.max(1, Number(c.req.query("windowDays")) || 30));
  const result = await Registry.getInstance().recommendationAnalyticsService.getLineageReport(windowDays);
  const res: ApiResponse<typeof result> = { success: true, data: result };
  return c.json(res);
});

// R4: the search intents feeding recommendations (§10) — aggregate-only, identity-free.
routes.get("/analytics/search-intelligence", requirePermissions([PERMISSIONS.RECOMMENDATIONS_READ]), async (c) => {
  const limit = Math.min(50, Math.max(1, Number(c.req.query("limit")) || 15));
  const result = await Registry.getInstance().searchAffinityReader.searchIntelligence(limit);
  const res: ApiResponse<typeof result> = { success: true, data: result };
  return c.json(res);
});

routes.get("/analytics", requirePermissions([PERMISSIONS.RECOMMENDATIONS_READ]), async (c) => {
  const registry = Registry.getInstance();
  const service = registry.recommendationAnalyticsService;

  const query = {
    startDate: c.req.query("startDate"),
    endDate: c.req.query("endDate"),
    placement: c.req.query("placement") as any,
    ruleId: c.req.query("ruleId"),
    productId: c.req.query("productId"),
    eventType: c.req.query("eventType") as any,
  };

  try {
    const result = await service.getAnalytics(query);
    const res: ApiResponse<typeof result> = { success: true, data: result };
    return c.json(res);
  } catch (err: any) {
    if (err.message === "startDate must be before endDate.") {
      return c.json({
        success: false,
        error: {
          code: "END_BEFORE_START",
          message: "End date cannot be earlier than start date."
        }
      }, 400);
    }
    if (err.message === "Invalid date format.") {
      return c.json({
        success: false,
        error: {
          code: "INVALID_DATE_RANGE",
          message: "Invalid date format."
        }
      }, 400);
    }
    return c.json({ 
      success: false, 
      error: { 
        code: "ANALYTICS_QUERY_FAILED", 
        message: "Failed to fetch analytics." 
      } 
    }, 400);
  }
});

export default routes;
