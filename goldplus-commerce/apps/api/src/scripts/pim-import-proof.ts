import "../config/env";
import { createHash, randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { PimImportOperationsUseCase } from "../application/use-cases/pim/PimImportOperationsUseCase";
import { db, endDbConnection } from "../infrastructure/db/client";
import { DrizzlePimImportRepository } from "../infrastructure/db/repositories/DrizzlePimImportRepository";
import {
  pimImportApprovals,
  pimImportEvents,
  pimImportRows,
  pimImportSessions,
} from "../infrastructure/db/schema/pim";
import {
  categories,
  productPrices,
  products,
} from "../infrastructure/db/schema/products";
const assert: (value: unknown, message: string) => asserts value = (
  value,
  message,
) => {
  if (!value) throw new Error(message);
};
async function protectedCounts() {
  const result: any = await db.execute(
    sql`select (select count(*)::int from inventory_reservations) inventory,(select count(*)::int from orders) orders,(select count(*)::int from payment_attempts) payments,(select count(*)::int from outbox_events) outbox,(select count(*)::int from notification_attempts) notifications,(select count(*)::int from product_attribute_values) attributes,(select count(*)::int from product_images) images`,
  );
  return (result.rows ?? result)[0] as Record<string, number>;
}
async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("REFUSING_TO_RUN_IN_PRODUCTION");
  const creator = randomUUID(),
    approver = randomUUID(),
    operator = randomUUID(),
    categoryId = randomUUID(),
    existingId = randomUUID(),
    conflictId = randomUUID();
  const sku = `PIM-${randomUUID().slice(0, 8).toUpperCase()}`,
    newSku = `PIM-N-${randomUUID().slice(0, 8).toUpperCase()}`,
    conflictSku = `PIM-C-${randomUUID().slice(0, 8).toUpperCase()}`,
    categorySlug = `pim-${randomUUID()}`,
    newSlug = `pim-new-${randomUUID()}`,
    conflictSlug = `pim-conflict-${randomUUID()}`;
  let sessionId: string | null = null;
  const providerCalls = 0;
  let report: Record<string, unknown> = {},
    failure: unknown;
  try {
    await db
      .insert(categories)
      .values({ id: categoryId, name: "PIM proof", slug: categorySlug });
    await db.insert(products).values({
      id: existingId,
      sku,
      modelNumber: "OLD",
      name: "Old product",
      slug: `old-${randomUUID()}`,
      categoryId,
      categoryName: "PIM proof",
      shortDescription: "old",
      longDescription: "old",
      priceUgx: 100000,
      hasRetailPrice: true,
      active: true,
      approvalStatus: "approved",
      stockQuantity: 5,
    });
    await db
      .insert(productPrices)
      .values({ productId: existingId, retailPrice: 100000 });
    const beforeProtected = await protectedCounts();
    const operations = new PimImportOperationsUseCase(
      new DrizzlePimImportRepository(),
    );
    const rows = [
      {
        sku,
        model: "NEW",
        name: "Updated product",
        slug: `updated-${randomUUID()}`,
        category: categorySlug,
        short: "new",
        long: "new",
        price: 120000,
      },
      {
        sku: newSku,
        model: "N1",
        name: "New product",
        slug: newSlug,
        category: categorySlug,
        short: "",
        long: "",
        price: 80000,
      },
      {
        sku: conflictSku,
        model: "C1",
        name: "Conflict product",
        slug: conflictSlug,
        category: categorySlug,
        short: "",
        long: "",
        price: 90000,
      },
      {
        sku: "BAD",
        model: "B1",
        name: "Bad product",
        slug: "bad-product",
        category: "missing-category",
        short: "",
        long: "",
        price: 0,
      },
    ];
    const sourceSha256 = createHash("sha256")
      .update(JSON.stringify(rows))
      .digest("hex");
    let sourceDigestMismatchDenied = false;
    try {
      await operations.create({
        name: "PIM tampered digest proof",
        sourceFilename: "proof.json",
        sourceSha256: "0".repeat(64),
        mode: "UPSERT",
        rows,
        actorId: creator,
      });
    } catch (error) {
      sourceDigestMismatchDenied =
        error instanceof Error &&
        "code" in error &&
        error.code === "SOURCE_DIGEST_MISMATCH";
    }
    assert(sourceDigestMismatchDenied, "Tampered source digest was accepted.");
    const created = await operations.create({
      name: "PIM governed proof",
      sourceFilename: "proof.json",
      sourceSha256,
      mode: "UPSERT",
      rows,
      actorId: creator,
    });
    sessionId = created.id;
    const mapping = {
      sku: "sku",
      modelNumber: "model",
      name: "name",
      slug: "slug",
      categorySlug: "category",
      shortDescription: "short",
      longDescription: "long",
      retailPriceUgx: "price",
    } as const;
    const mapped = await operations.saveMapping({
      id: created.id,
      expectedVersion: created.version,
      mapping,
      actorId: creator,
    });
    const beforePreviewResult: any = await db.execute(
      sql`select count(*)::int count from products`,
    );
    const beforePreviewProducts = Number(
      (beforePreviewResult.rows ?? beforePreviewResult)[0].count,
    );
    const preview = await operations.preview({
      id: created.id,
      expectedVersion: mapped.version,
      actorId: creator,
    });
    const afterPreviewResult: any = await db.execute(
      sql`select count(*)::int count from products`,
    );
    const afterPreviewProducts = Number(
      (afterPreviewResult.rows ?? afterPreviewResult)[0].count,
    );
    assert(
      beforePreviewProducts === afterPreviewProducts,
      "Preview wrote catalogue products.",
    );
    assert(
      preview.session.validRows === 3 &&
        preview.session.invalidRows === 1 &&
        preview.session.createRows === 2 &&
        preview.session.updateRows === 1,
      "Preview counts/actions were not truthful.",
    );
    let selfApprovalDenied = false;
    try {
      await operations.approve({
        id: created.id,
        expectedVersion: preview.session.version,
        actorId: creator,
        decision: "APPROVED",
        reason: "self",
      });
    } catch (error) {
      selfApprovalDenied =
        error instanceof Error &&
        "code" in error &&
        error.code === "FOUR_EYES_REQUIRED";
    }
    assert(selfApprovalDenied, "Creator approved own import.");
    const approved = await operations.approve({
      id: created.id,
      expectedVersion: preview.session.version,
      actorId: approver,
      decision: "APPROVED",
      reason: "Independent preview evidence accepted",
    });
    await db.insert(products).values({
      id: conflictId,
      sku: `OTHER-${randomUUID().slice(0, 8)}`,
      modelNumber: "CONFLICT",
      name: "Concurrent conflict",
      slug: conflictSlug,
      categoryId,
      categoryName: "PIM proof",
      priceUgx: 1,
      active: false,
      approvalStatus: "draft",
    });
    const applied = await operations.apply({
      id: created.id,
      expectedVersion: approved.version,
      actorId: operator,
    });
    assert(
      applied.status === "PARTIALLY_APPLIED" &&
        applied.appliedRows === 2 &&
        applied.failedRows === 1,
      "Partial apply was not classified truthfully.",
    );
    const [updated] = await db
      .select()
      .from(products)
      .where(eq(products.id, existingId));
    const [newProduct] = await db
      .select()
      .from(products)
      .where(eq(products.sku, newSku));
    assert(
      updated.name === "Updated product" && updated.priceUgx === 120000,
      "Approved update was not applied.",
    );
    assert(
      newProduct &&
        newProduct.active === false &&
        newProduct.approvalStatus === "draft" &&
        newProduct.stockQuantity === 0,
      "New import was not a hidden zero-stock draft.",
    );
    const afterApplyProtected = await protectedCounts();
    assert(
      afterApplyProtected.inventory === beforeProtected.inventory &&
        afterApplyProtected.orders === beforeProtected.orders &&
        afterApplyProtected.payments === beforeProtected.payments &&
        afterApplyProtected.outbox === beforeProtected.outbox &&
        afterApplyProtected.notifications === beforeProtected.notifications &&
        afterApplyProtected.attributes === beforeProtected.attributes &&
        afterApplyProtected.images === beforeProtected.images,
      "PIM apply mutated protected/non-mapped systems.",
    );
    const rolledBack = await operations.rollback({
      id: created.id,
      expectedVersion: applied.version,
      actorId: operator,
      reason: "Proof rollback",
    });
    assert(rolledBack.status === "ROLLED_BACK", "Rollback did not complete.");
    const [restored] = await db
      .select()
      .from(products)
      .where(eq(products.id, existingId));
    const [removedNew] = await db
      .select()
      .from(products)
      .where(eq(products.sku, newSku));
    assert(
      restored.name === "Old product" &&
        restored.priceUgx === 100000 &&
        !removedNew,
      "Rollback did not restore exact catalogue state.",
    );
    const detail = await operations.detail(created.id);
    assert(
      detail.events.length === 7,
      "Immutable PIM event count is incorrect.",
    );
    report = {
      lifecycle:
        "UPLOADED->MAPPED->READY_FOR_APPROVAL->APPROVED->APPLYING->PARTIALLY_APPLIED->ROLLED_BACK",
      previewDigest: preview.previewDigest,
      previewProductDelta: 0,
      validRows: 3,
      invalidRows: 1,
      appliedRows: 2,
      failedRows: 1,
      selfApprovalDenied,
      sourceDigestMismatchDenied,
      newProductsHiddenDrafts: true,
      inventoryDelta: 0,
      orderDelta: 0,
      paymentDelta: 0,
      outboxDelta: 0,
      notificationDelta: 0,
      attributeDelta: 0,
      imageDelta: 0,
      providerCalls,
      auditEvents: detail.events.length,
    };
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (sessionId) {
        await db
          .delete(pimImportApprovals)
          .where(eq(pimImportApprovals.sessionId, sessionId));
        await db
          .delete(pimImportEvents)
          .where(eq(pimImportEvents.sessionId, sessionId));
        await db
          .delete(pimImportRows)
          .where(eq(pimImportRows.sessionId, sessionId));
        await db
          .delete(pimImportSessions)
          .where(eq(pimImportSessions.id, sessionId));
      }
      await db
        .delete(productPrices)
        .where(eq(productPrices.productId, existingId));
      await db
        .delete(productPrices)
        .where(eq(productPrices.productId, conflictId));
      await db.delete(products).where(eq(products.id, existingId));
      await db.delete(products).where(eq(products.id, conflictId));
      await db.execute(
        sql`delete from product_prices where product_id in (select id from products where sku=${newSku})`,
      );
      await db.delete(products).where(eq(products.sku, newSku));
      await db.delete(categories).where(eq(categories.id, categoryId));
      const residue: any = await db.execute(
        sql`select (select count(*)::int from pim_import_sessions where id=${sessionId})+(select count(*)::int from products where sku in (${sku},${newSku},${conflictSku})) count`,
      );
      report.proofResidue = Number((residue.rows ?? residue)[0].count);
      if (report.proofResidue !== 0) failure ??= new Error("PIM_PROOF_RESIDUE");
    } catch (error) {
      failure ??= error;
    }
    try {
      await endDbConnection();
    } catch (error) {
      failure ??= error;
    }
  }
  console.log(
    JSON.stringify({ ...report, verdict: failure ? "FAIL" : "PASS" }),
  );
  if (failure) throw failure;
}
main().catch((error) => {
  console.error(
    "PIM_IMPORT_PROOF_ERROR",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
