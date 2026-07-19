import '../config/env';
import { randomUUID } from 'node:crypto';
import { db } from '../infrastructure/db/client';
import { products, categories } from '../infrastructure/db/schema/products';
import { decisionInsights, decisionEvidence, decisionRecommendations, decisionEvents } from '../infrastructure/db/schema/decision_intelligence';
import { DrizzleDecisionEvidenceReader } from '../infrastructure/db/repositories/DrizzleDecisionEvidenceReader';
import { DrizzleDecisionInsightRepository } from '../infrastructure/db/repositories/DrizzleDecisionInsightRepository';
import { DrizzleAuditRepository } from '../infrastructure/db/repositories/DrizzleAuditRepository';
import { EvaluateDecisionSignalsBatchUseCase, TransitionDecisionInsightUseCase } from '../application/use-cases/decision-intelligence/DecisionIntelligenceUseCases';
import { buildInsightIdempotencyKey } from '../domain/decision-intelligence/DecisionIntelligence';
import { and, eq, inArray, like } from 'drizzle-orm';

/**
 * Real-PostgreSQL proof (Decision Intelligence): concurrent evaluators produce one
 * canonical insight (unique idempotency key), evidence stays linked, repeated
 * evaluation does not duplicate, a stale-version transition is rejected, and a
 * resolved insight is not silently reopened by the same evidence window.
 * Refuses to run in production.
 */
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSING_TO_RUN_IN_PRODUCTION');

  // Seed low-stock products so LOW_STOCK_RISK yields a real insight.
  const catId = randomUUID();
  await db.insert(categories).values({ id: catId, name: `di-${catId.slice(0, 8)}`, slug: `di-${catId.slice(0, 8)}` });
  const prodIds: string[] = [];
  for (let i = 0; i < 4; i++) {
    const id = randomUUID(); prodIds.push(id);
    await db.insert(products).values({ id, sku: `DI-${id.slice(0, 8)}`, modelNumber: 'M', name: 'DI Widget', slug: `di-${id.slice(0, 8)}`, categoryId: catId, shortDescription: 'x', approvalStatus: 'approved', hasRetailPrice: true, stockQuantity: 1, reservedQuantity: 0, reorderPoint: 5 });
  }

  const reader = new DrizzleDecisionEvidenceReader();
  const repo = new DrizzleDecisionInsightRepository();
  const audit = new DrizzleAuditRepository();
  const evaluate = new EvaluateDecisionSignalsBatchUseCase(reader, repo, audit);
  const transition = new TransitionDecisionInsightUseCase(repo, audit);
  const now = new Date();
  const key = buildInsightIdempotencyKey({ category: 'INVENTORY', signalType: 'LOW_STOCK_RISK', subject: 'platform', windowKey: `0d@${now.toISOString().slice(0, 10)}`, policyVersion: 1 });

  // Concurrent evaluators on the same signal.
  const [a, b] = await Promise.all([
    evaluate.execute({ actorId: randomUUID(), now, onlySignal: 'LOW_STOCK_RISK' }),
    evaluate.execute({ actorId: randomUUID(), now, onlySignal: 'LOW_STOCK_RISK' }),
  ]);
  const rows = await db.select().from(decisionInsights).where(eq(decisionInsights.idempotencyKey, key));
  const insightId = rows[0]?.id;
  const evCount = insightId ? (await db.select().from(decisionEvidence).where(eq(decisionEvidence.insightId, insightId))).length : 0;
  const createdCount = (a.result.created) + (b.result.created);

  // Repeated evaluation does not duplicate.
  const again = await evaluate.execute({ actorId: randomUUID(), now, onlySignal: 'LOW_STOCK_RISK' });
  const rowsAfter = await db.select().from(decisionInsights).where(eq(decisionInsights.idempotencyKey, key));

  // Stale-version transition race: two acknowledges at the same expected version.
  const v0 = rows[0].version;
  const [t1, t2] = await Promise.all([
    transition.execute({ id: insightId, actorId: randomUUID(), expectedVersion: v0, toStatus: 'ACKNOWLEDGED', eventType: 'ACKNOWLEDGE' }),
    transition.execute({ id: insightId, actorId: randomUUID(), expectedVersion: v0, toStatus: 'ACKNOWLEDGED', eventType: 'ACKNOWLEDGE' }),
  ]);
  const ackWinners = [t1.ok, t2.ok].filter(Boolean).length;

  // Resolve, then re-evaluate: resolved insight is not silently reopened.
  const cur = await repo.findDetail(insightId);
  const resolved = await transition.execute({ id: insightId, actorId: randomUUID(), expectedVersion: cur!.version, toStatus: 'RESOLVED', eventType: 'RESOLVE', resolutionCode: 'ACTION_COMPLETED' });
  const reeval = await evaluate.execute({ actorId: randomUUID(), now, onlySignal: 'LOW_STOCK_RISK' });
  const afterResolve = await repo.findDetail(insightId);

  const ok =
    createdCount === 1 &&
    rows.length === 1 && evCount >= 1 &&
    again.result.created === 0 && rowsAfter.length === 1 &&
    ackWinners === 1 &&
    resolved.ok === true &&
    reeval.result.created === 0 && reeval.result.updated === 0 &&
    afterResolve?.status === 'RESOLVED';

  console.log(JSON.stringify({
    concurrentCreated: createdCount, insightRows: rows.length, evidenceLinked: evCount,
    repeatCreated: again.result.created, rowsAfterRepeat: rowsAfter.length,
    ackWinners, resolvedOk: resolved.ok,
    reopenBlocked: reeval.result.created === 0 && reeval.result.updated === 0 && afterResolve?.status === 'RESOLVED',
    verdict: ok ? 'PASS' : 'FAIL',
  }));

  // Cleanup this proof's rows.
  const myInsights = await db.select({ id: decisionInsights.id }).from(decisionInsights).where(like(decisionInsights.idempotencyKey, 'decision:INVENTORY:LOW_STOCK_RISK:%'));
  const ids = myInsights.map((r) => r.id);
  if (ids.length) {
    await db.delete(decisionEvidence).where(inArray(decisionEvidence.insightId, ids));
    await db.delete(decisionRecommendations).where(inArray(decisionRecommendations.insightId, ids));
    await db.delete(decisionEvents).where(inArray(decisionEvents.insightId, ids));
    await db.delete(decisionInsights).where(inArray(decisionInsights.id, ids));
  }
  await db.delete(products).where(inArray(products.id, prodIds));
  await db.delete(categories).where(eq(categories.id, catId));

  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error('DI_PROOF_ERROR', e?.message); process.exit(1); });
