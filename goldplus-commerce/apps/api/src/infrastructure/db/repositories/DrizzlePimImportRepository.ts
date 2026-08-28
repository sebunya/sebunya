import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  IPimImportRepository,
  PimImportRowRecord,
  PimImportSessionRecord,
} from "../../../application/ports/IPimImportRepository";
import {
  NormalizedPimProduct,
  PimImportMode,
  PimImportStatus,
  PimMapping,
} from "../../../domain/pim/PimImport";
import { client, db } from "../client";
import { categories, productPrices, products } from "../schema/products";
import {
  pimImportApprovals,
  pimImportEvents,
  pimImportRows,
  pimImportSessions,
} from "../schema/pim";

const jsonb = (value: unknown) => sql`${client.json(value as any)}::jsonb`;
const sessionRecord = (
  row: typeof pimImportSessions.$inferSelect,
): PimImportSessionRecord => ({
  ...row,
  mode: row.mode as PimImportMode,
  status: row.status as PimImportStatus,
  mapping: row.mapping as PimMapping | null,
});
const rowRecord = (
  row: typeof pimImportRows.$inferSelect,
): PimImportRowRecord => ({
  ...row,
  sourceData: row.sourceData as Record<string, unknown>,
  normalizedData: row.normalizedData as NormalizedPimProduct | null,
  validationErrors: row.validationErrors as string[],
  action: row.action as PimImportRowRecord["action"],
  status: row.status as PimImportRowRecord["status"],
  beforeSnapshot: row.beforeSnapshot as Record<string, unknown> | null,
  afterSnapshot: row.afterSnapshot as Record<string, unknown> | null,
});
const snapshot = (
  product: typeof products.$inferSelect,
  retailPriceUgx: number | null,
) => ({
  productId: product.id,
  sku: product.sku,
  modelNumber: product.modelNumber,
  name: product.name,
  slug: product.slug,
  categoryId: product.categoryId,
  categoryName: product.categoryName,
  shortDescription: product.shortDescription,
  longDescription: product.longDescription,
  priceUgx: product.priceUgx,
  hasRetailPrice: product.hasRetailPrice,
  active: product.active,
  approvalStatus: product.approvalStatus,
  stockQuantity: product.stockQuantity,
  retailPriceUgx,
});
const sameSnapshot = (
  current: Record<string, unknown>,
  expected: Record<string, unknown>,
) => Object.keys(expected).every((key) => current[key] === expected[key]);

export class DrizzlePimImportRepository implements IPimImportRepository {
  private async event(
    tx: any,
    sessionId: string,
    actorId: string,
    action: string,
    reason: string,
    evidence: Record<string, unknown>,
  ) {
    await tx.insert(pimImportEvents).values({
      sessionId,
      actorId,
      action,
      reason,
      evidence: jsonb(evidence) as any,
    });
  }
  async create(input: {
    name: string;
    sourceFilename: string;
    sourceSha256: string;
    mode: PimImportMode;
    rows: Record<string, unknown>[];
    actorId: string;
  }) {
    return db.transaction(async (tx) => {
      const inserted = await tx
        .insert(pimImportSessions)
        .values({
          name: input.name,
          sourceFilename: input.sourceFilename,
          sourceSha256: input.sourceSha256,
          mode: input.mode,
          totalRows: input.rows.length,
          createdBy: input.actorId,
        })
        .onConflictDoNothing({ target: pimImportSessions.sourceSha256 })
        .returning();
      if (!inserted.length) {
        const [existing] = await tx
          .select()
          .from(pimImportSessions)
          .where(eq(pimImportSessions.sourceSha256, input.sourceSha256))
          .limit(1);
        return sessionRecord(existing);
      }
      const session = inserted[0];
      await tx.insert(pimImportRows).values(
        input.rows.map((row, index) => ({
          sessionId: session.id,
          rowNumber: index + 1,
          sourceData: jsonb(row) as any,
          validationErrors: jsonb([]) as any,
        })),
      );
      await this.event(
        tx,
        session.id,
        input.actorId,
        "INGESTED",
        "Immutable source rows ingested.",
        {
          sourceSha256: input.sourceSha256,
          totalRows: input.rows.length,
          mode: input.mode,
        },
      );
      return sessionRecord(session);
    });
  }
  async list() {
    return (
      await db
        .select()
        .from(pimImportSessions)
        .orderBy(desc(pimImportSessions.createdAt))
    ).map(sessionRecord);
  }
  async find(id: string) {
    const [row] = await db
      .select()
      .from(pimImportSessions)
      .where(eq(pimImportSessions.id, id))
      .limit(1);
    return row ? sessionRecord(row) : null;
  }
  async rows(id: string) {
    return (
      await db
        .select()
        .from(pimImportRows)
        .where(eq(pimImportRows.sessionId, id))
        .orderBy(asc(pimImportRows.rowNumber))
    ).map(rowRecord);
  }
  async catalogueLookup() {
    const productRows = await db.select().from(products);
    const priceRows = await db.select().from(productPrices);
    const priceByProduct = new Map(
      priceRows.map((row) => [row.productId, row.retailPrice]),
    );
    return {
      categories: await db
        .select({
          id: categories.id,
          slug: categories.slug,
          name: categories.name,
        })
        .from(categories),
      products: productRows.map((row) => ({
        id: row.id,
        sku: row.sku,
        slug: row.slug,
        catalogueSnapshot: snapshot(row, priceByProduct.get(row.id) ?? null),
      })),
    };
  }
  async saveMapping(
    id: string,
    expectedVersion: number,
    mapping: PimMapping,
    actorId: string,
  ) {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .update(pimImportSessions)
        .set({
          mapping: jsonb(mapping) as any,
          status: "MAPPED",
          previewDigest: null,
          version: sql`${pimImportSessions.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(pimImportSessions.id, id),
            eq(pimImportSessions.version, expectedVersion),
            inArray(pimImportSessions.status, ["UPLOADED", "MAPPED"]),
          ),
        )
        .returning();
      if (!row) return null;
      await tx
        .update(pimImportRows)
        .set({
          normalizedData: null,
          validationErrors: jsonb([]) as any,
          action: "PENDING",
          status: "PENDING",
          targetProductId: null,
          beforeSnapshot: null,
          afterSnapshot: null,
          error: null,
        })
        .where(eq(pimImportRows.sessionId, id));
      await this.event(
        tx,
        id,
        actorId,
        "MAPPING_SAVED",
        "Explicit source-to-catalogue mapping saved.",
        { targetFields: Object.keys(mapping).sort(), version: row.version },
      );
      return sessionRecord(row);
    });
  }
  async savePreview(
    id: string,
    expectedVersion: number,
    previewDigest: string,
    rows: Array<{
      rowId: string;
      normalizedData: NormalizedPimProduct | null;
      validationErrors: string[];
      action: "CREATE" | "UPDATE" | "SKIP";
      targetProductId: string | null;
      beforeSnapshot: Record<string, unknown> | null;
    }>,
    actorId: string,
  ) {
    return db.transaction(async (tx) => {
      const validRows = rows.filter(
        (row) => row.validationErrors.length === 0 && row.action !== "SKIP",
      ).length;
      const invalidRows = rows.length - validRows;
      const [session] = await tx
        .update(pimImportSessions)
        .set({
          status: "READY_FOR_APPROVAL",
          previewDigest,
          validRows,
          invalidRows,
          createRows: rows.filter((row) => row.action === "CREATE").length,
          updateRows: rows.filter((row) => row.action === "UPDATE").length,
          version: sql`${pimImportSessions.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(pimImportSessions.id, id),
            eq(pimImportSessions.version, expectedVersion),
            eq(pimImportSessions.status, "MAPPED"),
          ),
        )
        .returning();
      if (!session) return null;
      for (const row of rows)
        await tx
          .update(pimImportRows)
          .set({
            normalizedData: row.normalizedData
              ? (jsonb(row.normalizedData) as any)
              : null,
            validationErrors: jsonb(row.validationErrors) as any,
            action: row.action,
            status:
              row.validationErrors.length || row.action === "SKIP"
                ? "INVALID"
                : "VALID",
            targetProductId: row.targetProductId,
            beforeSnapshot: row.beforeSnapshot
              ? (jsonb(row.beforeSnapshot) as any)
              : null,
          })
          .where(
            and(
              eq(pimImportRows.id, row.rowId),
              eq(pimImportRows.sessionId, id),
            ),
          );
      await this.event(
        tx,
        id,
        actorId,
        "DRY_RUN_COMPLETED",
        "Deterministic preview completed without catalogue writes.",
        { previewDigest, validRows, invalidRows },
      );
      return sessionRecord(session);
    });
  }
  async approve(input: {
    id: string;
    expectedVersion: number;
    actorId: string;
    decision: "APPROVED" | "REJECTED";
    reason: string;
  }) {
    return db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(pimImportSessions)
        .where(
          and(
            eq(pimImportSessions.id, input.id),
            eq(pimImportSessions.version, input.expectedVersion),
            eq(pimImportSessions.status, "READY_FOR_APPROVAL"),
          ),
        )
        .limit(1);
      if (!current || !current.previewDigest) return null;
      const [row] = await tx
        .update(pimImportSessions)
        .set({
          status: input.decision,
          approvedBy: input.decision === "APPROVED" ? input.actorId : null,
          approvedAt: input.decision === "APPROVED" ? new Date() : null,
          version: sql`${pimImportSessions.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(pimImportSessions.id, input.id),
            eq(pimImportSessions.version, input.expectedVersion),
          ),
        )
        .returning();
      await tx.insert(pimImportApprovals).values({
        sessionId: input.id,
        decision: input.decision,
        actorId: input.actorId,
        reason: input.reason,
        previewDigest: current.previewDigest,
      });
      await this.event(
        tx,
        input.id,
        input.actorId,
        input.decision,
        input.reason,
        {
          previewDigest: current.previewDigest,
          validRows: current.validRows,
          invalidRows: current.invalidRows,
        },
      );
      return sessionRecord(row);
    });
  }
  async beginApply(id: string, expectedVersion: number, actorId: string) {
    return db.transaction(async (tx) => {
      const [row] = await tx
        .update(pimImportSessions)
        .set({
          status: "APPLYING",
          version: sql`${pimImportSessions.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(pimImportSessions.id, id),
            eq(pimImportSessions.version, expectedVersion),
            eq(pimImportSessions.status, "APPROVED"),
          ),
        )
        .returning();
      if (!row) return null;
      await this.event(
        tx,
        id,
        actorId,
        "APPLY_STARTED",
        "Approved preview apply started.",
        { previewDigest: row.previewDigest },
      );
      return sessionRecord(row);
    });
  }
  async applyRow(row: PimImportRowRecord) {
    if (
      !row.normalizedData ||
      row.status !== "VALID" ||
      !["CREATE", "UPDATE"].includes(row.action)
    )
      return { ok: false as const, error: "Row is not eligible for apply." };
    try {
      await db.transaction(async (tx) => {
        const data = row.normalizedData!;
        const [category] = await tx
          .select()
          .from(categories)
          .where(eq(categories.slug, data.categorySlug))
          .limit(1);
        if (!category) throw new Error("Category no longer exists.");
        const [existing] = await tx
          .select()
          .from(products)
          .where(eq(products.sku, data.sku))
          .limit(1);
        const [slugOwner] = await tx
          .select()
          .from(products)
          .where(eq(products.slug, data.slug))
          .limit(1);
        if (row.action === "CREATE") {
          if (existing || slugOwner)
            throw new Error("Catalogue conflict changed after preview.");
          const [created] = await tx
            .insert(products)
            .values({
              sku: data.sku,
              modelNumber: data.modelNumber,
              name: data.name,
              slug: data.slug,
              categoryId: category.id,
              categoryName: category.name,
              shortDescription: data.shortDescription,
              longDescription: data.longDescription,
              priceUgx: data.retailPriceUgx,
              hasRetailPrice: true,
              stockStatus: "out_of_stock",
              stockQuantity: 0,
              active: false,
              approvalStatus: "draft",
              features: jsonb([]) as any,
              specifications: jsonb({}) as any,
            })
            .returning();
          await tx.insert(productPrices).values({
            productId: created.id,
            retailPrice: data.retailPriceUgx,
          });
          const after = snapshot(created, data.retailPriceUgx);
          await tx
            .update(pimImportRows)
            .set({
              status: "APPLIED",
              targetProductId: created.id,
              beforeSnapshot: null,
              afterSnapshot: jsonb(after) as any,
              error: null,
            })
            .where(eq(pimImportRows.id, row.id));
        } else {
          const [price] = await tx
            .select()
            .from(productPrices)
            .where(
              eq(productPrices.productId, existing?.id ?? row.targetProductId!),
            )
            .limit(1);
          if (
            !existing ||
            existing.id !== row.targetProductId ||
            (slugOwner && slugOwner.id !== existing.id) ||
            !row.beforeSnapshot ||
            !sameSnapshot(
              snapshot(existing, price?.retailPrice ?? null),
              row.beforeSnapshot,
            )
          )
            throw new Error("Catalogue conflict changed after preview.");
          const before = row.beforeSnapshot;
          const [updated] = await tx
            .update(products)
            .set({
              modelNumber: data.modelNumber,
              name: data.name,
              // The live slug is kept. Rewriting it here moved the URL with no
              // redirect and no lastmod; a slug change goes through the admin
              // edit, which records the redirect.
              slug: existing.slug,
              updatedAt: new Date(),
              categoryId: category.id,
              categoryName: category.name,
              shortDescription: data.shortDescription,
              longDescription: data.longDescription,
              priceUgx: data.retailPriceUgx,
              hasRetailPrice: true,
            })
            .where(eq(products.id, existing.id))
            .returning();
          if (price)
            await tx
              .update(productPrices)
              .set({ retailPrice: data.retailPriceUgx })
              .where(eq(productPrices.productId, existing.id));
          else
            await tx.insert(productPrices).values({
              productId: existing.id,
              retailPrice: data.retailPriceUgx,
            });
          await tx
            .update(pimImportRows)
            .set({
              status: "APPLIED",
              beforeSnapshot: jsonb(before) as any,
              afterSnapshot: jsonb(
                snapshot(updated, data.retailPriceUgx),
              ) as any,
              error: null,
            })
            .where(eq(pimImportRows.id, row.id));
        }
      });
      return { ok: true as const };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Row apply failed.";
      await db
        .update(pimImportRows)
        .set({ status: "FAILED", error: message })
        .where(eq(pimImportRows.id, row.id));
      return { ok: false as const, error: message };
    }
  }
  async finishApply(id: string, actorId: string) {
    return db.transaction(async (tx) => {
      const [counts] = await tx
        .select({
          applied: sql<number>`count(*) filter (where ${pimImportRows.status}='APPLIED')::int`,
          failed: sql<number>`count(*) filter (where ${pimImportRows.status}='FAILED')::int`,
        })
        .from(pimImportRows)
        .where(eq(pimImportRows.sessionId, id));
      const [current] = await tx
        .select()
        .from(pimImportSessions)
        .where(eq(pimImportSessions.id, id))
        .limit(1);
      if (!current) throw new Error("NOT_FOUND");
      const status =
        counts.applied > 0 && (counts.failed > 0 || current.invalidRows > 0)
          ? "PARTIALLY_APPLIED"
          : counts.applied > 0
            ? "APPLIED"
            : "FAILED";
      const [row] = await tx
        .update(pimImportSessions)
        .set({
          status,
          appliedRows: counts.applied,
          failedRows: counts.failed,
          version: sql`${pimImportSessions.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(pimImportSessions.id, id),
            eq(pimImportSessions.status, "APPLYING"),
          ),
        )
        .returning();
      // Another worker finished this apply first: the guarded update matched
      // nothing. Report its result rather than spreading undefined, which
      // turned a lost race into a TypeError instead of a quiet no-op.
      if (!row) {
        const [settled] = await tx
          .select()
          .from(pimImportSessions)
          .where(eq(pimImportSessions.id, id))
          .limit(1);
        if (!settled) throw new Error("NOT_FOUND");
        return sessionRecord(settled);
      }
      await this.event(
        tx,
        id,
        actorId,
        "APPLY_COMPLETED",
        "Approved preview apply completed.",
        {
          status,
          appliedRows: counts.applied,
          failedRows: counts.failed,
          invalidRows: current.invalidRows,
        },
      );
      return sessionRecord(row);
    });
  }
  async rollback(
    id: string,
    expectedVersion: number,
    actorId: string,
    reason: string,
  ) {
    const session = await this.find(id);
    if (
      !session ||
      session.version !== expectedVersion ||
      !["APPLIED", "PARTIALLY_APPLIED"].includes(session.status)
    )
      return null;
    const applied = (await this.rows(id)).filter(
      (row) => row.status === "APPLIED",
    );
    let failed = 0;
    for (const row of applied.reverse())
      try {
        await db.transaction(async (tx) => {
          const after = row.afterSnapshot!;
          const productId = String(after.productId);
          const [current] = await tx
            .select()
            .from(products)
            .where(eq(products.id, productId))
            .limit(1);
          const [price] = await tx
            .select()
            .from(productPrices)
            .where(eq(productPrices.productId, productId))
            .limit(1);
          if (
            !current ||
            !sameSnapshot(snapshot(current, price?.retailPrice ?? null), after)
          )
            throw new Error("Product changed after import.");
          if (row.action === "CREATE") {
            await tx
              .delete(productPrices)
              .where(eq(productPrices.productId, productId));
            await tx.delete(products).where(eq(products.id, productId));
          } else {
            const before = row.beforeSnapshot!;
            await tx
              .update(products)
              .set({
                modelNumber: String(before.modelNumber),
                name: String(before.name),
                slug: String(before.slug),
                categoryId: String(before.categoryId),
                categoryName: before.categoryName as string | null,
                shortDescription: String(before.shortDescription),
                longDescription: String(before.longDescription),
                priceUgx: Number(before.priceUgx),
                hasRetailPrice: Boolean(before.hasRetailPrice),
              })
              .where(eq(products.id, productId));
            if (before.retailPriceUgx === null)
              await tx
                .delete(productPrices)
                .where(eq(productPrices.productId, productId));
            else if (price)
              await tx
                .update(productPrices)
                .set({ retailPrice: Number(before.retailPriceUgx) })
                .where(eq(productPrices.productId, productId));
            else
              await tx.insert(productPrices).values({
                productId,
                retailPrice: Number(before.retailPriceUgx),
              });
          }
          await tx
            .update(pimImportRows)
            .set({ status: "ROLLED_BACK", error: null })
            .where(eq(pimImportRows.id, row.id));
        });
      } catch {
        failed += 1;
      }
    return db.transaction(async (tx) => {
      const status = failed ? "ROLLBACK_PARTIAL" : "ROLLED_BACK";
      const [row] = await tx
        .update(pimImportSessions)
        .set({
          status,
          version: sql`${pimImportSessions.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(pimImportSessions.id, id),
            eq(pimImportSessions.version, expectedVersion),
          ),
        )
        .returning();
      if (!row) return null;
      await this.event(tx, id, actorId, "ROLLBACK_COMPLETED", reason, {
        status,
        rolledBackRows: applied.length - failed,
        failedRows: failed,
      });
      return sessionRecord(row);
    });
  }
  async events(id: string) {
    return await db
      .select()
      .from(pimImportEvents)
      .where(eq(pimImportEvents.sessionId, id))
      .orderBy(asc(pimImportEvents.createdAt));
  }
}
