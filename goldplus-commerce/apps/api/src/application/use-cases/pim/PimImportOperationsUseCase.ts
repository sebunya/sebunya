import { createHash } from "node:crypto";
import { IPimImportRepository } from "../../ports/IPimImportRepository";
import {
  PIM_TARGET_FIELDS,
  PimImportMode,
  PimMapping,
  normalizePimRow,
  pimPreviewDigest,
  validatePimMapping,
} from "../../../domain/pim/PimImport";

export class PimImportOperationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class PimImportOperationsUseCase {
  constructor(private readonly repo: IPimImportRepository) {}
  async create(input: {
    name: string;
    sourceFilename: string;
    sourceSha256: string;
    mode: PimImportMode;
    rows: Record<string, unknown>[];
    actorId: string;
  }) {
    if (!input.name.trim() || input.name.length > 160)
      throw new PimImportOperationError(
        "INVALID_IMPORT",
        "Import name is required and limited to 160 characters.",
      );
    if (!/^[A-Za-z0-9._ -]{1,255}$/.test(input.sourceFilename))
      throw new PimImportOperationError(
        "INVALID_IMPORT",
        "Source filename is invalid.",
      );
    if (!/^[a-f0-9]{64}$/.test(input.sourceSha256))
      throw new PimImportOperationError(
        "INVALID_IMPORT",
        "Source SHA-256 is required.",
      );
    if (input.rows.length < 1 || input.rows.length > 1000)
      throw new PimImportOperationError(
        "INVALID_IMPORT",
        "Import must contain between 1 and 1000 rows.",
      );
    for (const row of input.rows) {
      const entries = Object.entries(row);
      if (
        !entries.length ||
        entries.length > 50 ||
        entries.some(
          ([key, value]) =>
            !/^[A-Za-z0-9_.-]{1,80}$/.test(key) ||
            /(password|secret|token|email|phone|address|customer)/i.test(key) ||
            !["string", "number", "boolean"].includes(typeof value) ||
            String(value).length > 5000,
        )
      )
        throw new PimImportOperationError(
          "INVALID_IMPORT_ROW",
          "Source rows must contain bounded non-sensitive scalar catalogue fields.",
        );
    }
    const canonicalDigest = createHash("sha256")
      .update(JSON.stringify(input.rows))
      .digest("hex");
    if (canonicalDigest !== input.sourceSha256)
      throw new PimImportOperationError(
        "SOURCE_DIGEST_MISMATCH",
        "Source SHA-256 does not match the ingested canonical rows.",
      );
    return this.repo.create({
      ...input,
      name: input.name.trim(),
      sourceSha256: canonicalDigest,
    });
  }
  list() {
    return this.repo.list();
  }
  async detail(id: string) {
    const session = await this.repo.find(id);
    if (!session)
      throw new PimImportOperationError(
        "IMPORT_NOT_FOUND",
        "PIM import was not found.",
      );
    return {
      session,
      rows: await this.repo.rows(id),
      events: await this.repo.events(id),
      safeguards: {
        previewRequired: true,
        approvalRequired: true,
        newProductsHiddenDrafts: true,
        inventoryImportEnabled: false,
        fabricatedAttributesAllowed: false,
      },
    };
  }
  /**
   * §10 downloadable error report: every row that failed validation (or errored on
   * apply), with its row number, the exact messages, and the source snippet the
   * operator needs to fix the file. Derived from stored state — never recomputed —
   * so the report matches what the preview refused.
   */
  async errorReport(id: string): Promise<{ sessionId: string; rows: Array<{ rowNumber: number; errors: string[]; source: Record<string, unknown> }> }> {
    const rows = await this.repo.rows(id);
    const bad = rows
      .filter((r: any) => (Array.isArray(r.validationErrors) && r.validationErrors.length > 0) || r.error)
      .map((r: any) => ({
        rowNumber: r.rowNumber,
        errors: [
          ...(Array.isArray(r.validationErrors) ? r.validationErrors.map((e: unknown) => String(typeof e === 'object' && e !== null && 'message' in (e as any) ? (e as any).message : e)) : []),
          ...(r.error ? [String(r.error)] : []),
        ],
        source: (r.sourceData ?? {}) as Record<string, unknown>,
      }));
    return { sessionId: id, rows: bad };
  }

  async saveMapping(input: {
    id: string;
    expectedVersion: number;
    mapping: Partial<PimMapping>;
    actorId: string;
  }) {
    const errors = validatePimMapping(input.mapping);
    if (errors.length)
      throw new PimImportOperationError("INVALID_MAPPING", errors[0]);
    const updated = await this.repo.saveMapping(
      input.id,
      input.expectedVersion,
      input.mapping as PimMapping,
      input.actorId,
    );
    if (!updated)
      throw new PimImportOperationError(
        "STALE_VERSION",
        "Import changed or is no longer mappable.",
      );
    return updated;
  }
  async preview(input: {
    id: string;
    expectedVersion: number;
    actorId: string;
  }) {
    const session = await this.repo.find(input.id);
    if (!session)
      throw new PimImportOperationError(
        "IMPORT_NOT_FOUND",
        "PIM import was not found.",
      );
    if (session.status !== "MAPPED" || !session.mapping)
      throw new PimImportOperationError(
        "INVALID_STATE",
        "A complete mapping is required before preview.",
      );
    const [rows, lookup] = await Promise.all([
      this.repo.rows(input.id),
      this.repo.catalogueLookup(),
    ]);
    const categories = new Set(lookup.categories.map((item) => item.slug));
    const bySku = new Map(lookup.products.map((item) => [item.sku, item]));
    const bySlug = new Map(lookup.products.map((item) => [item.slug, item]));
    const seenSku = new Set<string>();
    const seenSlug = new Set<string>();
    const preview = rows.map((row) => {
      const normalized = normalizePimRow(row.sourceData, session.mapping!);
      const errors = [...normalized.errors];
      let action: "CREATE" | "UPDATE" | "SKIP" = "SKIP";
      let targetProductId: string | null = null;
      let beforeSnapshot: Record<string, unknown> | null = null;
      if (normalized.value) {
        if (seenSku.has(normalized.value.sku))
          errors.push("Duplicate SKU within source.");
        if (seenSlug.has(normalized.value.slug))
          errors.push("Duplicate slug within source.");
        seenSku.add(normalized.value.sku);
        seenSlug.add(normalized.value.slug);
        if (!categories.has(normalized.value.categorySlug))
          errors.push("Mapped category does not exist.");
        const existing = bySku.get(normalized.value.sku);
        const slugOwner = bySlug.get(normalized.value.slug);
        if (existing && session.mode === "CREATE_ONLY")
          errors.push(
            "Existing SKU cannot be overwritten in CREATE_ONLY mode.",
          );
        if (slugOwner && (!existing || slugOwner.id !== existing.id))
          errors.push("Slug belongs to another catalogue product.");
        if (!errors.length) {
          action = existing ? "UPDATE" : "CREATE";
          targetProductId = existing?.id ?? null;
          beforeSnapshot = existing?.catalogueSnapshot ?? null;
        }
      }
      return {
        rowId: row.id,
        rowNumber: row.rowNumber,
        normalizedData: normalized.value,
        validationErrors: errors,
        action,
        targetProductId,
        beforeSnapshot,
      };
    });
    const digest = pimPreviewDigest(
      preview.map((row) => ({
        rowNumber: row.rowNumber,
        action: row.action,
        value: row.normalizedData,
        errors: row.validationErrors,
      })),
    );
    const updated = await this.repo.savePreview(
      input.id,
      input.expectedVersion,
      digest,
      preview,
      input.actorId,
    );
    if (!updated)
      throw new PimImportOperationError(
        "STALE_VERSION",
        "Import changed before preview could be stored.",
      );
    return { session: updated, previewDigest: digest, rows: preview };
  }
  async approve(input: {
    id: string;
    expectedVersion: number;
    actorId: string;
    decision: "APPROVED" | "REJECTED";
    reason: string;
  }) {
    const session = await this.repo.find(input.id);
    if (!session)
      throw new PimImportOperationError(
        "IMPORT_NOT_FOUND",
        "PIM import was not found.",
      );
    if (session.createdBy === input.actorId)
      throw new PimImportOperationError(
        "FOUR_EYES_REQUIRED",
        "Import creator cannot approve the same import.",
      );
    if (!input.reason.trim())
      throw new PimImportOperationError(
        "REASON_REQUIRED",
        "Approval reason is required.",
      );
    if (input.decision === "APPROVED" && session.validRows < 1)
      throw new PimImportOperationError(
        "NO_VALID_ROWS",
        "An import with no valid rows cannot be approved.",
      );
    const updated = await this.repo.approve({
      ...input,
      reason: input.reason.trim(),
    });
    if (!updated)
      throw new PimImportOperationError(
        "STALE_VERSION",
        "Import changed or is not ready for approval.",
      );
    return updated;
  }
  async apply(input: { id: string; expectedVersion: number; actorId: string }) {
    const applying = await this.repo.beginApply(
      input.id,
      input.expectedVersion,
      input.actorId,
    );
    if (!applying)
      throw new PimImportOperationError(
        "STALE_VERSION",
        "Import changed or is not approved for apply.",
      );
    const rows = (await this.repo.rows(input.id)).filter(
      (row) => row.status === "VALID",
    );
    for (const row of rows) await this.repo.applyRow(row);
    return this.repo.finishApply(input.id, input.actorId);
  }
  async rollback(input: {
    id: string;
    expectedVersion: number;
    actorId: string;
    reason: string;
  }) {
    if (!input.reason.trim())
      throw new PimImportOperationError(
        "REASON_REQUIRED",
        "Rollback reason is required.",
      );
    const updated = await this.repo.rollback(
      input.id,
      input.expectedVersion,
      input.actorId,
      input.reason.trim(),
    );
    if (!updated)
      throw new PimImportOperationError(
        "STALE_VERSION",
        "Import changed or is not rollback eligible.",
      );
    return updated;
  }
  mappingFields() {
    return [...PIM_TARGET_FIELDS];
  }
}
