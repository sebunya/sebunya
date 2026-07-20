import '../config/env';
import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { RecordSearchEventUseCase, RecordSearchInteractionUseCase } from '../application/use-cases/products/SearchUseCases';
import { db, endDbConnection } from '../infrastructure/db/client';
import { DrizzleSearchDemandRepository } from '../infrastructure/db/repositories/DrizzleSearchDemandRepository';
import { searchDemandSignals, searchProductInsights } from '../infrastructure/db/schema/search';
import { categories, products } from '../infrastructure/db/schema/products';

const assert: (value: unknown, message: string) => asserts value = (value, message) => { if (!value) throw new Error(message); };
async function protectedCounts() { const result: any = await db.execute(sql`select (select count(*)::int from consent_events) consent,(select count(*)::int from consent_records) consent_records,(select count(*)::int from customer_preferences) preferences,(select count(*)::int from carts) carts,(select count(*)::int from cart_items) cart_items,(select count(*)::int from orders) orders,(select count(*)::int from payment_attempts) payments,(select count(*)::int from outbox_events) outbox,(select count(*)::int from notification_attempts) notifications`); return (result.rows ?? result)[0] as Record<string,number>; }

async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSING_TO_RUN_IN_PRODUCTION');
  const categoryId = randomUUID(); const productIds = [randomUUID(), randomUUID()];
  const queries = ['power bank', 'portable charger', 'solar generator', 'one-off niche'];
  const repo = new DrizzleSearchDemandRepository(); const recordSearch = new RecordSearchEventUseCase(repo); const interact = new RecordSearchInteractionUseCase(repo);
  const providerCalls = 0; let report: Record<string, unknown> = {}; let failure: unknown;
  try {
    await db.insert(categories).values({ id: categoryId, name: 'Search proof', slug: `search-${categoryId}` });
    await db.insert(products).values(productIds.map((id, index) => ({ id, sku: `SEARCH-${id.slice(0,8)}`, modelNumber: `S${index}`, name: index === 0 ? 'Portable Power Bank' : 'Solar Power Station', slug: `search-${id}`, categoryId, categoryName: 'Power', approvalStatus: 'approved', active: true, hasRetailPrice: true, priceUgx: 100_000 })));
    const before = await protectedCounts();

    const concurrent = await Promise.all(Array.from({ length: 10 }, () => recordSearch.execute({ query: queries[0], resultCount: 2, rankedProductIds: productIds })));
    assert(concurrent.every((result) => result.recorded), 'Concurrent searches were dropped.');
    for (let i = 0; i < 3; i++) await recordSearch.execute({ query: queries[1], resultCount: 2, rankedProductIds: productIds });
    for (let i = 0; i < 3; i++) await recordSearch.execute({ query: queries[2], resultCount: 0, rankedProductIds: [] });
    await recordSearch.execute({ query: queries[3], resultCount: 0, rankedProductIds: [] });

    const clickResults = await Promise.all(Array.from({ length: 14 }, () => interact.execute({ query: queries[0], productId: productIds[0], rank: 1, type: 'click' })));
    const recordedClicks = clickResults.filter((result) => result.recorded).length;
    assert(recordedClicks === 10, 'Clicks did not cap at observed impressions.');
    for (let i = 0; i < 2; i++) assert((await interact.execute({ query: queries[1], productId: productIds[0], rank: 1, type: 'click' })).recorded, 'Synonym evidence click was rejected.');
    const conversionResults = await Promise.all(Array.from({ length: 14 }, () => interact.execute({ query: queries[0], productId: productIds[0], rank: 1, type: 'add_to_cart' })));
    const recordedConversions = conversionResults.filter((result) => result.recorded).length;
    assert(recordedConversions === 10, 'Add-to-cart conversion did not cap at clicks.');
    assert((await interact.execute({ query: 'never observed', productId: productIds[0], rank: 1, type: 'click' })).recorded === false, 'Interaction without an impression was recorded.');
    assert((await interact.execute({ query: queries[0], productId: productIds[0], rank: 0, type: 'click' })).recorded === false, 'Invalid rank was recorded.');

    const insights = await repo.getInsights(100);
    const primary = insights.ranking.find((row) => row.query === queries[0] && row.productId === productIds[0]);
    assert(primary?.impressions === 10 && primary.clicks === 10 && primary.addToCartConversions === 10, 'Primary ranking counters diverged.');
    assert(primary.clickThroughRate === 1 && primary.addToCartRate === 1 && primary.averageObservedRank === 1, 'Rates/rank are not deterministic and bounded.');
    assert(insights.demand.some((row) => row.query === queries[2] && row.zeroResultCount === 3), 'Zero-result demand is missing.');
    assert(!insights.demand.some((row) => row.query === queries[3]) && !insights.ranking.some((row) => row.query === queries[3]), 'Low-volume query was disclosed.');
    const synonym = insights.synonymCandidates.find((row) => [row.query, row.candidate].includes(queries[0]) && [row.query, row.candidate].includes(queries[1]));
    assert(synonym?.status === 'EVIDENCE_ONLY' && synonym.evidenceClicks === 2, 'Aggregate synonym candidate evidence is missing.');

    const [concurrentRow] = await db.select().from(searchDemandSignals).where(eq(searchDemandSignals.query, queries[0]));
    const [productRow] = await db.select().from(searchProductInsights).where(eq(searchProductInsights.query, queries[0]));
    assert(concurrentRow.searchCount === 10 && productRow.impressionCount === 10, 'Concurrent atomic counters lost updates.');
    const columns: any = await db.execute(sql`select column_name from information_schema.columns where table_schema='public' and table_name='search_product_insights'`);
    const columnNames = (columns.rows ?? columns).map((row: any) => row.column_name).join(' ');
    assert(!/(visitor|session|browser|customer|email|phone|cart|order|payment|consent)/i.test(columnNames), 'Personal/history linkage exists in aggregate insight schema.');
    const after = await protectedCounts(); for (const key of Object.keys(before)) assert(before[key] === after[key], `${key} changed during Search Insights proof.`);
    report = { concurrentSearches: 10, recordedImpressions: productRow.impressionCount, recordedClicks, recordedConversions, clickCapEnforced: true, conversionCapEnforced: true, interactionWithoutImpressionDenied: true, zeroResultSearches: 3, lowVolumeSuppressed: true, rankingRows: insights.ranking.length, averageObservedRank: primary.averageObservedRank, clickThroughRate: primary.clickThroughRate, addToCartRate: primary.addToCartRate, synonymCandidates: insights.synonymCandidates.length, synonymStatus: synonym.status, rawHistoryColumns: 0, consentDelta: 0, preferenceDelta: 0, cartDelta: 0, orderDelta: 0, paymentDelta: 0, outboxDelta: 0, notificationDelta: 0, providerCalls };
  } catch (error) { failure = error; }
  finally {
    try { await db.delete(searchProductInsights).where(inArray(searchProductInsights.query, queries)); await db.delete(searchDemandSignals).where(inArray(searchDemandSignals.query, queries)); await db.delete(products).where(inArray(products.id, productIds)); await db.delete(categories).where(eq(categories.id, categoryId)); const residue: any = await db.execute(sql`select (select count(*)::int from search_demand_signals where query in (${queries[0]},${queries[1]},${queries[2]},${queries[3]}))+(select count(*)::int from products where id in (${productIds[0]},${productIds[1]})) count`); report.proofResidue = Number((residue.rows ?? residue)[0].count); assert(report.proofResidue === 0, 'Search Insights proof residue remains.'); } catch (error) { failure ??= error; }
    try { await endDbConnection(); } catch (error) { failure ??= error; }
  }
  console.log(JSON.stringify({ ...report, verdict: failure ? 'FAIL' : 'PASS' })); if (failure) throw failure;
}
main().catch((error) => { console.error('SEARCH_INSIGHTS_PROOF_ERROR', error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
