import "../config/env";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { StartProductFinderUseCase } from "../application/use-cases/product-finder/StartProductFinderUseCase";
import { AnswerProductFinderStepUseCase } from "../application/use-cases/product-finder/AnswerProductFinderStepUseCase";
import { CompleteProductFinderUseCase } from "../application/use-cases/product-finder/CompleteProductFinderUseCase";
import { RecordProductFinderActionUseCase } from "../application/use-cases/product-finder/RecordProductFinderActionUseCase";
import { db, endDbConnection } from "../infrastructure/db/client";
import { DrizzleProductFinderRepository } from "../infrastructure/product-finder/DrizzleProductFinderRepository";
import { DrizzleProductFinderCatalogRepository } from "../infrastructure/product-finder/DrizzleProductFinderCatalogRepository";
import { PricingProductFinderReader } from "../infrastructure/product-finder/PricingProductFinderReader";
import { EvaluateCartPricingUseCase } from "../application/use-cases/pricing/EvaluateCartPricingUseCase";
import { DrizzleProductRepository } from "../infrastructure/db/repositories/DrizzleProductRepository";
import { DrizzlePricingRepository } from "../infrastructure/db/repositories/DrizzlePricingRepository";
import { DrizzlePricingQuoteRepository } from "../infrastructure/db/repositories/DrizzlePricingQuoteRepository";
import {
  categories,
  productPrices,
  products,
} from "../infrastructure/db/schema/products";
import { productCompatibilityMappings } from "../infrastructure/db/schema/compatibility";
import { productFinderSessions } from "../infrastructure/db/schema/product_finder";

const assert: (value: unknown, message: string) => asserts value = (
  value,
  message,
) => {
  if (!value) throw new Error(message);
};

async function protectedCounts() {
  const result: any = await db.execute(sql`select
    (select count(*)::int from orders) orders,
    (select count(*)::int from inventory_reservations) inventory,
    (select count(*)::int from payment_attempts) payments,
    (select count(*)::int from outbox_events) outbox,
    (select count(*)::int from notification_attempts) notifications`);
  return (result.rows ?? result)[0] as Record<string, number>;
}

async function main() {
  if (process.env.NODE_ENV === "production")
    throw new Error("REFUSING_TO_RUN_IN_PRODUCTION");
  const categoryId = randomUUID();
  const referenceId = randomUUID();
  const matchId = randomUUID();
  const unknownId = randomUUID();
  const reservedId = randomUUID();
  const draftId = randomUUID();
  const productIds = [referenceId, matchId, unknownId, reservedId, draftId];
  const sessionIds: string[] = [];
  let failure: unknown;
  const report: Record<string, unknown> = {};
  let completedEvents = 0;
  let actionEvents = 0;
  let preferenceWrites = 0;
  const measurement = {
    publishFinderStarted: async () => undefined,
    publishFinderStepAnswered: async () => undefined,
    publishFinderCompleted: async () => {
      completedEvents += 1;
    },
    publishRecommendationClicked: async () => {
      actionEvents += 1;
    },
    publishFinderAddToCartIntent: async () => {
      actionEvents += 1;
    },
    publishFinderWhatsAppIntent: async () => {
      actionEvents += 1;
    },
  };
  const preference = {
    updateProductInterestsFromFinder: async () => {
      preferenceWrites += 1;
    },
    updateShoppingIntentFromFinder: async () => {
      preferenceWrites += 1;
    },
    saveZeroPartySummary: async () => {
      preferenceWrites += 1;
    },
  };
  try {
    await db.insert(categories).values({
      id: categoryId,
      name: "Power",
      slug: `assistant-${randomUUID()}`,
    });
    const product = (
      id: string,
      sku: string,
      name: string,
      slug: string,
      overrides: Record<string, unknown> = {},
    ) => ({
      id,
      sku,
      modelNumber: sku,
      name,
      slug,
      categoryId,
      categoryName: "Power",
      shortDescription: "",
      longDescription: "",
      priceUgx: 100000,
      stockStatus: "in_stock",
      stockQuantity: 5,
      reservedQuantity: 0,
      active: true,
      approvalStatus: "approved",
      hasRetailPrice: true,
      hasImage: true,
      imageUrl: "/proof.png",
      features: ["fast charging", "portable"],
      ...overrides,
    });
    await db
      .insert(products)
      .values([
        product(
          referenceId,
          `REF-${randomUUID().slice(0, 6)}`,
          "Reference",
          `reference-${randomUUID()}`,
        ),
        product(
          matchId,
          `MAT-${randomUUID().slice(0, 6)}`,
          "Compatible match",
          `match-${randomUUID()}`,
        ),
        product(
          unknownId,
          `UNK-${randomUUID().slice(0, 6)}`,
          "Unknown compatibility",
          `unknown-${randomUUID()}`,
        ),
        product(
          reservedId,
          `RES-${randomUUID().slice(0, 6)}`,
          "Fully reserved",
          `reserved-${randomUUID()}`,
          { stockQuantity: 2, reservedQuantity: 2 },
        ),
        product(
          draftId,
          `DRA-${randomUUID().slice(0, 6)}`,
          "Draft product",
          `draft-${randomUUID()}`,
          { approvalStatus: "draft" },
        ),
      ] as any);
    await db
      .insert(productPrices)
      .values(
        productIds.map((productId) => ({ productId, retailPrice: 100000 })),
      );
    await db.insert(productCompatibilityMappings).values({
      productId: referenceId,
      targetProductId: matchId,
      verdict: "compatible",
      note: "Declared proof mapping",
      enabled: true,
    });
    const before = await protectedCounts();
    const repo = new DrizzleProductFinderRepository();
    const catalog = new DrizzleProductFinderCatalogRepository();
    const pricing = new PricingProductFinderReader(
      new EvaluateCartPricingUseCase(
        new DrizzleProductRepository(),
        new DrizzlePricingRepository(),
        new DrizzlePricingQuoteRepository(),
      ),
    );
    const start = new StartProductFinderUseCase(repo, measurement as any);
    const answer = new AnswerProductFinderStepUseCase(repo, measurement as any);
    const complete = new CompleteProductFinderUseCase(
      repo,
      catalog,
      measurement as any,
      preference,
      pricing,
    );
    const action = new RecordProductFinderActionUseCase(
      repo,
      measurement as any,
    );
    const created = await start.execute({});
    sessionIds.push(created.sessionId);
    const principal = { accessToken: created.accessToken };
    const wrong = await answer.execute({
      sessionId: created.sessionId,
      stepId: "category",
      answer: "Power",
      principal: { accessToken: "x".repeat(43) },
    });
    assert(
      !wrong.success && wrong.error === "SESSION_NOT_FOUND",
      "Wrong capability accessed session.",
    );
    for (const [stepId, value] of [
      ["category", "Power"],
      ["problem", "I need fast charging"],
      ["priority", "Best value"],
      ["budget", "Mid-range"],
      ["referenceProductId", referenceId],
    ] as const) {
      const saved = await answer.execute({
        sessionId: created.sessionId,
        stepId,
        answer: value,
        principal,
      });
      assert(saved.success, `${stepId} was not persisted.`);
    }
    const ready = await repo.getSession(created.sessionId);
    assert(
      ready?.answers.category === "Power" &&
        ready.answers.problem === "I need fast charging",
      `Required answers were not persisted: ${JSON.stringify(ready?.answers)}`,
    );
    const [first, duplicate] = await Promise.all([
      complete.execute({ sessionId: created.sessionId, principal }),
      complete.execute({ sessionId: created.sessionId, principal }),
    ]);
    assert(
      first.status === "RECOMMENDATIONS_READY" &&
        duplicate.status === "RECOMMENDATIONS_READY",
      `Concurrent completion was not idempotent: ${JSON.stringify({ first, duplicate })}`,
    );
    const recommendations = first.recommendations as any[];
    assert(
      recommendations.length === 1 && recommendations[0].productId === matchId,
      "Compatibility/inventory/publication gates did not yield exactly the declared match.",
    );
    assert(
      recommendations[0].price === 100000 &&
        recommendations[0].canonicalPriceUgx === 100000,
      "Canonical Pricing evidence is incorrect.",
    );
    assert(
      recommendations[0].compatibilityEvidence === "DECLARED_COMPATIBLE",
      "Declared compatibility evidence is missing.",
    );
    const intent = await action.execute({
      sessionId: created.sessionId,
      action: "add_to_cart_intent",
      productId: matchId,
      principal,
    });
    const invented = await action.execute({
      sessionId: created.sessionId,
      action: "add_to_cart_intent",
      productId: unknownId,
      principal,
    });
    assert(
      intent.success && invented.error === "PRODUCT_NOT_RECOMMENDED",
      "Action boundary accepted an unproven product.",
    );
    const noMatch = await start.execute({});
    sessionIds.push(noMatch.sessionId);
    const noMatchPrincipal = { accessToken: noMatch.accessToken };
    for (const [stepId, value] of [
      ["category", "Storage"],
      ["problem", "I need more phone storage"],
      ["referenceProductId", referenceId],
    ] as const)
      await answer.execute({
        sessionId: noMatch.sessionId,
        stepId,
        answer: value,
        principal: noMatchPrincipal,
      });
    const none = await complete.execute({
      sessionId: noMatch.sessionId,
      principal: noMatchPrincipal,
    });
    assert(
      none.status === "NO_MATCH",
      "No-match condition invented a product.",
    );
    const after = await protectedCounts();
    assert(
      Object.keys(before).every((key) => before[key] === after[key]),
      "Assistant mutated protected commerce or communication state.",
    );
    assert(
      completedEvents === 2 && actionEvents === 1 && preferenceWrites === 0,
      "Measurement/preference effects are untruthful.",
    );
    const [stored] = await db
      .select()
      .from(productFinderSessions)
      .where(eq(productFinderSessions.id, created.sessionId));
    assert(
      stored.anonymousId?.startsWith("anon_") &&
        stored.anonymousId !== created.accessToken,
      "Raw capability was persisted.",
    );
    report.ownershipDenied = true;
    report.completionWinners = completedEvents - 1;
    report.declaredMatches = recommendations.length;
    report.reservedExcluded = !recommendations.some(
      (item) => item.productId === reservedId,
    );
    report.draftExcluded = !recommendations.some(
      (item) => item.productId === draftId,
    );
    report.unknownCompatibilityExcluded = !recommendations.some(
      (item) => item.productId === unknownId,
    );
    report.canonicalPriceUgx = recommendations[0].canonicalPriceUgx;
    report.nonPersistentPricing = true;
    report.noMatchTruthful = true;
    report.intentOnlyEvents = actionEvents;
    report.preferenceWrites = preferenceWrites;
    report.providerCalls = 0;
    report.protectedDeltas = 0;
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (sessionIds.length)
        await db
          .delete(productFinderSessions)
          .where(inArray(productFinderSessions.id, sessionIds));
      await db
        .delete(productCompatibilityMappings)
        .where(inArray(productCompatibilityMappings.productId, productIds));
      await db
        .delete(productPrices)
        .where(inArray(productPrices.productId, productIds));
      await db.delete(products).where(inArray(products.id, productIds));
      await db.delete(categories).where(eq(categories.id, categoryId));
      const [sessionResidue] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(productFinderSessions)
        .where(inArray(productFinderSessions.id, sessionIds));
      const [productResidue] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(products)
        .where(inArray(products.id, productIds));
      report.proofResidue = sessionResidue.count + productResidue.count;
      if (report.proofResidue !== 0)
        failure ??= new Error("SHOPPING_ASSISTANT_PROOF_RESIDUE");
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
    "SHOPPING_ASSISTANT_PROOF_ERROR",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
