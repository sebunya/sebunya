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
    // R9: a refusal code this route does not know is a refusal, never a 201.
    return c.json({ success: false, error: { code: "RECOMMENDATION_RULE_REFUSED", message: "The rule was refused." } }, 422);
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
    return c.json({ success: false, error: { code: "RECOMMENDATION_RULE_REFUSED", message: "The edit was refused." } }, 422);
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
    // R9: every refusal used to wear 404 — including the two-person gate and
    // the transition matrix. The code now tells the truth.
    if (result.code === "NOT_FOUND") {
      return c.json({ success: false, error: { code: "RECOMMENDATION_RULE_NOT_FOUND", message: result.message } }, 404);
    }
    if (result.code === "SECOND_ADMIN_REQUIRED") {
      return c.json({ success: false, error: { code: "SECOND_ADMIN_REQUIRED", message: result.message } }, 403);
    }
    return c.json({ success: false, error: { code: "ILLEGAL_STATUS_TRANSITION", message: result.message } }, 409);
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

  const parsedLimit = Number(body.limit);
  const result = await uc.execute({
    placement: body.placement,
    productId: body.productId,
    categoryId: body.categoryId,
    categorySlug: body.categorySlug,
    cartProductIds: Array.isArray(body.cartProductIds) ? body.cartProductIds.slice(0, 50) : undefined,
    limit: Number.isInteger(parsedLimit) ? Math.min(24, Math.max(1, parsedLimit)) : undefined,
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

// R3.1: the commercial-intelligence report — every metric carries its state
// (OK / NOT_ENOUGH_DATA / PARTIAL / UNAVAILABLE+reason); nothing is a bare zero.
routes.get("/analytics/commercial", requirePermissions([PERMISSIONS.RECOMMENDATIONS_READ]), async (c) => {
  const windowDays = Math.min(365, Math.max(1, Number(c.req.query("windowDays")) || 30));
  const result = await Registry.getInstance().recommendationCommercialService.getCommercialReport(windowDays);
  const res: ApiResponse<typeof result> = { success: true, data: result };
  return c.json(res);
});

/**
 * One row's validation, shared by the single, batch and preview paths so they
 * cannot drift apart. Returns the normalised fact or the reasons it is not one.
 */
const validateMediaCostRow = (
  row: any,
): { ok: true; fact: Record<string, unknown> } | { ok: false; errors: string[] } => {
  const errors: string[] = [];
  // R3.1 review (minor 6): a REAL calendar date — the regex alone let
  // 2026-99-99 through to a Postgres cast failure dressed as a 500 — and
  // never in the future: spend that has not happened cannot be ingested.
  const dateShape = typeof row?.spendDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.spendDate);
  const parsedDate = dateShape ? new Date(`${row.spendDate}T00:00:00Z`) : null;
  const dateReal = parsedDate !== null && !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === row.spendDate;
  if (!dateReal) errors.push("spendDate must be a real YYYY-MM-DD date.");
  else if (parsedDate!.getTime() > Date.now()) errors.push("spendDate cannot be in the future.");

  const FIELD_CAPS = { channel: 40, platform: 80, account: 120, campaign: 150, source: 120 } as const;
  for (const field of ["channel", "platform", "account", "campaign", "source"] as const) {
    const value = row?.[field];
    if (typeof value !== "string" || !value.trim()) errors.push(`${field} is required.`);
    else if (value.trim().length > FIELD_CAPS[field]) errors.push(`${field} exceeds ${FIELD_CAPS[field]} characters.`);
  }
  for (const field of ["adSetOrGroup", "adOrCreative"] as const) {
    if (typeof row?.[field] === "string" && row[field].length > 150) errors.push(`${field} exceeds 150 characters.`);
  }
  if (typeof row?.sourceReference === "string" && row.sourceReference.length > 200) errors.push("sourceReference exceeds 200 characters.");

  const MAX_SPEND_MINOR = 10_000_000_000; // UGX 10bn per row: beyond this is a typo, not a campaign.
  const spendMinor = Number(row?.spendMinor);
  if (!Number.isInteger(spendMinor) || spendMinor < 0 || spendMinor > MAX_SPEND_MINOR) errors.push("spendMinor must be a non-negative integer within a sane ceiling (minor units).");
  const taxOrFeeMinor = Number(row?.taxOrFeeMinor ?? 0);
  if (!Number.isInteger(taxOrFeeMinor) || taxOrFeeMinor < 0 || taxOrFeeMinor > MAX_SPEND_MINOR) errors.push("taxOrFeeMinor must be a non-negative integer within a sane ceiling.");
  const currency = String(row?.currency ?? "UGX").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) errors.push("currency must be a 3-letter code.");

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    fact: {
      spendDate: row.spendDate,
      channel: row.channel.trim(),
      platform: row.platform.trim(),
      account: row.account.trim(),
      campaign: row.campaign.trim(),
      adSetOrGroup: typeof row.adSetOrGroup === "string" ? row.adSetOrGroup.trim() || null : null,
      adOrCreative: typeof row.adOrCreative === "string" ? row.adOrCreative.trim() || null : null,
      currency,
      spendMinor,
      taxOrFeeMinor,
      source: row.source.trim(),
      sourceReference: typeof row.sourceReference === "string" ? row.sourceReference.trim() || null : null,
    },
  };
};

/**
 * Batch spend ingestion: validate the WHOLE file, then write all of it or none.
 *
 * `dryRun` runs identical validation and reports the same plan without writing,
 * so an operator sees what a file does before it does it. A partially applied
 * spend file is worse than a rejected one — it makes ROAS a blend of the new
 * numbers and the old with nothing recording which is which.
 *
 * Mixed currency is refused HERE, not only at report time. The report already
 * refuses to divide by a cross-currency sum, but by then the bad row is stored
 * and every ROAS read is dead until someone finds it.
 */
/**
 * Operator view of the canonical fact table (R4): freshness, totals and the
 * most recently ingested facts. Read-only; powers /admin/media-costs.
 */
routes.get("/media-costs/summary", requirePermissions([PERMISSIONS.RECOMMENDATIONS_READ]), async (c) => {
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 50));
  const data = await Registry.getInstance().recommendationCommercialRepo.getMediaCostOpsSummary(limit);
  return c.json({ success: true, data });
});

routes.post("/media-costs/batch", requirePermissions([PERMISSIONS.RECOMMENDATIONS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid body" } }, 400);

  const dryRun = body.dryRun === true;
  const rows = Array.isArray(body.rows) ? body.rows.slice(0, 5_000) : [];
  if (rows.length === 0) {
    return c.json({ success: false, error: { code: "EMPTY_BATCH", message: "The file contains no rows." } }, 400);
  }

  const rowErrors: Array<{ rowNumber: number; errors: string[] }> = [];
  const facts: Array<Record<string, unknown>> = [];
  const logicalKeys = new Map<string, number>();

  rows.forEach((row: any, index: number) => {
    const rowNumber = index + 1;
    const verdict = validateMediaCostRow(row);
    if (!verdict.ok) return rowErrors.push({ rowNumber, errors: verdict.errors });

    // A file that states the same spend twice contradicts itself; the operator
    // decides which is right, not the importer.
    const f = verdict.fact;
    const key = [f.spendDate, f.channel, f.platform, f.account, f.campaign, f.adSetOrGroup ?? "", f.adOrCreative ?? "", f.source].join("|");
    const first = logicalKeys.get(key);
    if (first !== undefined) {
      return rowErrors.push({ rowNumber, errors: [`Row ${first} already states this exact spend fact. One file may not state it twice.`] });
    }
    logicalKeys.set(key, rowNumber);
    facts.push(f);
  });

  const batchCurrencies = [...new Set(facts.map((f) => String(f.currency)))];
  if (batchCurrencies.length > 1) {
    rowErrors.push({ rowNumber: 0, errors: [`The file mixes ${batchCurrencies.join(", ")}. A cross-currency spend total is not a number — ingest one currency per file.`] });
  } else if (batchCurrencies.length === 1) {
    const existing = await Registry.getInstance().recommendationCommercialRepo.getIngestedCurrencies();
    const conflicting = existing.filter((cur) => cur !== batchCurrencies[0]);
    if (conflicting.length > 0) {
      rowErrors.push({ rowNumber: 0, errors: [`Spend already exists in ${conflicting.join(", ")} and this file is ${batchCurrencies[0]}. Ingesting it would make ROAS unavailable for every period that spans both — convert to one currency first.`] });
    }
  }

  if (rowErrors.length > 0) {
    return c.json({ success: false, data: { accepted: false, dryRun, totalRows: rows.length, applied: 0, errors: rowErrors } }, 422);
  }

  if (dryRun) {
    return c.json({ success: true, data: { accepted: true, dryRun: true, totalRows: rows.length, applied: 0, errors: [], plan: facts } });
  }

  const repo = Registry.getInstance().recommendationCommercialRepo;
  let inserted = 0;
  let duplicates = 0;
  for (const fact of facts) {
    const result = await repo.insertMediaCostFact({ ...(fact as any), ingestedBy: (c.get("user") as { id: string }).id });
    if (result.inserted) inserted += 1;
    else duplicates += 1;
  }

  await Registry.getInstance().createAuditLogUseCase.execute({
    actorId: (c.get("user") as { id: string }).id,
    action: "MEDIA_COST_BATCH_INGESTED",
    entity: "media_cost_fact",
    entityId: `batch:${facts.length}:${String(facts[0]?.source ?? "unknown")}`,
    previousState: null,
    newState: { totalRows: rows.length, inserted, duplicates, currency: batchCurrencies[0] },
  });

  return c.json({ success: true, data: { accepted: true, dryRun: false, totalRows: rows.length, applied: inserted, duplicates, errors: [] } });
});

/**
 * Correct a spend fact already ingested. Without this a wrong number was
 * permanent: the logical-key conflict silently discarded the resubmission and
 * the report kept the bad figure forever.
 */
routes.post("/media-costs/correct", requirePermissions([PERMISSIONS.RECOMMENDATIONS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid body" } }, 400);

  const verdict = validateMediaCostRow(body);
  if (!verdict.ok) {
    return c.json({ success: false, error: { code: "INVALID_MEDIA_COST", message: verdict.errors.join(" ") } }, 400);
  }
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 10) {
    return c.json({ success: false, error: { code: "REASON_REQUIRED", message: "Correcting a spend figure needs a written reason of at least 10 characters." } }, 400);
  }

  const f = verdict.fact as any;
  const result = await Registry.getInstance().recommendationCommercialRepo.correctMediaCostFact({
    spendDate: f.spendDate,
    channel: f.channel,
    platform: f.platform,
    account: f.account,
    campaign: f.campaign,
    adSetOrGroup: f.adSetOrGroup,
    adOrCreative: f.adOrCreative,
    source: f.source,
    spendMinor: f.spendMinor,
    taxOrFeeMinor: f.taxOrFeeMinor,
  });

  if (!result.corrected) {
    return c.json({ success: false, error: { code: "FACT_NOT_FOUND", message: "No ingested spend fact matches that logical key, so there is nothing to correct." } }, 404);
  }

  await Registry.getInstance().createAuditLogUseCase.execute({
    actorId: (c.get("user") as { id: string }).id,
    action: "MEDIA_COST_CORRECTED",
    entity: "media_cost_fact",
    entityId: `${f.spendDate}:${f.platform}:${f.account}:${f.campaign}`,
    previousState: result.previous,
    newState: { spendMinor: f.spendMinor, taxOrFeeMinor: f.taxOrFeeMinor, reason },
  });

  return c.json({ success: true, data: { corrected: true, previous: result.previous } });
});

// R3.1 (§12): server-side media-spend ingestion into the ONE canonical fact
// table. Duplicate-protected by the logical key; spend is never invented.
routes.post("/media-costs", requirePermissions([PERMISSIONS.RECOMMENDATIONS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ success: false, error: { code: "INVALID_JSON", message: "Invalid body" } }, 400);

  const errors: string[] = [];
  // R3.1 review (minor 6): a REAL calendar date — the regex alone let
  // 2026-99-99 through to a Postgres cast failure dressed as a 500 — and
  // never in the future: spend that has not happened cannot be ingested.
  const dateShape = typeof body.spendDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.spendDate);
  const parsedDate = dateShape ? new Date(`${body.spendDate}T00:00:00Z`) : null;
  const dateReal = parsedDate !== null && !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().slice(0, 10) === body.spendDate;
  if (!dateReal) errors.push("spendDate must be a real YYYY-MM-DD date.");
  else if (parsedDate!.getTime() > Date.now()) errors.push("spendDate cannot be in the future.");
  const FIELD_CAPS = { channel: 40, platform: 80, account: 120, campaign: 150, source: 120 } as const;
  for (const field of ["channel", "platform", "account", "campaign", "source"] as const) {
    const value = body[field];
    if (typeof value !== "string" || !value.trim()) errors.push(`${field} is required.`);
    else if (value.trim().length > FIELD_CAPS[field]) errors.push(`${field} exceeds ${FIELD_CAPS[field]} characters.`);
  }
  for (const field of ["adSetOrGroup", "adOrCreative"] as const) {
    if (typeof body[field] === "string" && body[field].length > 150) errors.push(`${field} exceeds 150 characters.`);
  }
  if (typeof body.sourceReference === "string" && body.sourceReference.length > 200) errors.push("sourceReference exceeds 200 characters.");
  const MAX_SPEND_MINOR = 10_000_000_000; // UGX 10bn per row: beyond this is a typo, not a campaign.
  const spendMinor = Number(body.spendMinor);
  if (!Number.isInteger(spendMinor) || spendMinor < 0 || spendMinor > MAX_SPEND_MINOR) errors.push("spendMinor must be a non-negative integer within a sane ceiling (minor units).");
  const taxOrFeeMinor = Number(body.taxOrFeeMinor ?? 0);
  if (!Number.isInteger(taxOrFeeMinor) || taxOrFeeMinor < 0 || taxOrFeeMinor > MAX_SPEND_MINOR) errors.push("taxOrFeeMinor must be a non-negative integer within a sane ceiling.");
  const currency = String(body.currency ?? "UGX").toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) errors.push("currency must be a 3-letter code.");
  if (errors.length > 0) {
    return c.json({ success: false, error: { code: "INVALID_MEDIA_COST", message: errors.join(" ") } }, 400);
  }

  const result = await Registry.getInstance().recommendationCommercialRepo.insertMediaCostFact({
    spendDate: body.spendDate,
    channel: body.channel.trim(),
    platform: body.platform.trim(),
    account: body.account.trim(),
    campaign: body.campaign.trim(),
    adSetOrGroup: typeof body.adSetOrGroup === "string" ? body.adSetOrGroup.trim() || null : null,
    adOrCreative: typeof body.adOrCreative === "string" ? body.adOrCreative.trim() || null : null,
    currency,
    spendMinor,
    taxOrFeeMinor,
    source: body.source.trim(),
    sourceReference: typeof body.sourceReference === "string" ? body.sourceReference.trim() || null : null,
    ingestedBy: c.get("user").id,
  });
  // A financial write needs an audit row of its own. The file-scoped
  // `audit-exempt` marker at the top covers RULE mutations, which use the
  // dedicated rule-audit stream; spend ingestion is neither, and without this
  // a duplicate submission returned 200 leaving no trace of the attempt.
  await Registry.getInstance().createAuditLogUseCase.execute({
    actorId: c.get("user").id,
    action: result.inserted ? "MEDIA_COST_INGESTED" : "MEDIA_COST_DUPLICATE_REJECTED",
    entity: "media_cost_fact",
    // The logical key IS the identity of a spend fact (0102's unique index).
    entityId: `${body.spendDate}:${body.platform.trim()}:${body.account.trim()}:${body.campaign.trim()}`,
    previousState: null,
    newState: {
      spendDate: body.spendDate,
      channel: body.channel.trim(),
      platform: body.platform.trim(),
      account: body.account.trim(),
      campaign: body.campaign.trim(),
      currency,
      spendMinor,
      taxOrFeeMinor,
      source: body.source.trim(),
      inserted: result.inserted,
    },
  });

  return c.json({ success: true, data: { inserted: result.inserted, duplicate: !result.inserted } }, result.inserted ? 201 : 200);
});

// R8: the model-readiness decision, with its evidence beside it.
routes.get("/model/readiness", requirePermissions([PERMISSIONS.RECOMMENDATIONS_READ]), async (c) => {
  const result = await Registry.getInstance().recommendationModelReadinessUseCase.execute();
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
