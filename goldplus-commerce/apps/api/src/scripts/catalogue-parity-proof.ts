import '../config/env';
import { sql } from 'drizzle-orm';
import Redis from 'ioredis';
import { ListPublicProductsUseCase } from '../application/use-cases/products/ListPublicProductsUseCase';
import { db, endDbConnection } from '../infrastructure/db/client';
import { DrizzleProductRepository } from '../infrastructure/db/repositories/DrizzleProductRepository';
import {
  evaluateCatalogueParity,
  hashCatalogueIdentifiers,
  hashCatalogueIdentifiersAndPrices,
  loadIndependentCatalogueTruth,
  type CatalogueObservation,
  type CatalogueParityReasonCode,
  type IndependentCatalogueTruth,
} from '../infrastructure/scheduler/SyntheticMonitor';

const LIMIT = 5;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function protectedCounts(): Promise<Record<string, number>> {
  const result = await db.execute(sql`
    select
      (select count(*)::int from carts) as carts,
      (select count(*)::int from cart_items) as cart_items,
      (select count(*)::int from orders) as orders,
      (select count(*)::int from payment_attempts) as payment_attempts,
      (select count(*)::int from payments) as payments,
      (select count(*)::int from outbox_events) as outbox,
      (select count(*)::int from notification_attempts) as notifications,
      (select count(*)::int from consent_events) as consent_events
  `);
  const rows = result && typeof result === 'object' && 'rows' in result
    ? (result as { rows?: Array<Record<string, number | string>> }).rows ?? []
    : [];
  const row = rows[0] ?? {};
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value)]));
}

const observationsFromDtos = (
  rows: Array<{ id: string; slug: string; retailPriceUgx: number | null }>,
): CatalogueObservation[] =>
  rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    canonicalPriceUgx: row.retailPriceUgx,
  }));

const http = (body: unknown) => ({ status: 200, contentType: 'application/json', body });

function expectReason(
  truth: IndependentCatalogueTruth,
  body: unknown,
  expected: CatalogueParityReasonCode,
  target: { databaseName?: string; schemaName?: string } = {
    databaseName: truth.databaseName,
    schemaName: truth.schemaName,
  },
): void {
  const result = evaluateCatalogueParity(truth, http(body), target).result;
  assert(result.reasonCode === expected, `Expected ${expected}, received ${result.reasonCode}`);
}

async function main(): Promise<Record<string, unknown>> {
  if (process.env.NODE_ENV === 'production') throw new Error('REFUSING_TO_RUN_IN_PRODUCTION');
  const apiUrl = process.env.CATALOGUE_PARITY_API_URL;
  if (!apiUrl) throw new Error('CATALOGUE_PARITY_API_URL is required');

  const before = await protectedCounts();
  const providerCalls = 0;
  const truth = await loadIndependentCatalogueTruth(LIMIT);
  const repository = new DrizzleProductRepository();
  const repositoryRows = await repository.findPublicViewList({ limit: LIMIT });
  const repositoryObservations: CatalogueObservation[] = repositoryRows.map((row) => ({
    id: row.entity.id,
    slug: row.entity.slug,
    canonicalPriceUgx:
      typeof row.retailPriceUgx === 'number' && Number.isFinite(row.retailPriceUgx) && row.retailPriceUgx > 0
        ? Math.trunc(row.retailPriceUgx)
        : null,
  }));
  const dtoRows = await new ListPublicProductsUseCase(repository).execute({ limit: LIMIT });
  const dtoObservations = observationsFromDtos(dtoRows);

  const fetchCatalogue = async () => {
    const response = await fetch(`${apiUrl.replace(/\/$/, '')}/products?limit=${LIMIT}`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    const body = await response.json();
    return { response, body };
  };

  const cold = await fetchCatalogue();
  const coldParity = evaluateCatalogueParity(
    truth,
    {
      status: cold.response.status,
      contentType: cold.response.headers.get('content-type'),
      body: cold.body,
    },
    { databaseName: truth.databaseName, schemaName: truth.schemaName },
  );
  assert(coldParity.result.ok, `Cold API parity failed: ${coldParity.result.reasonCode}`);

  const redis = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379/0', {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  const staleKey = 'catalogue:public:limit=5';
  const expiredKey = 'products:public:limit=5';
  let redisBefore = 0;
  let redisAfter = 0;
  try {
    await redis.connect();
    await redis.del(staleKey, expiredKey);
    redisBefore = await redis.dbsize();

    const miss = await fetchCatalogue();
    const missParity = evaluateCatalogueParity(
      truth,
      {
        status: miss.response.status,
        contentType: miss.response.headers.get('content-type'),
        body: miss.body,
      },
      { databaseName: truth.databaseName, schemaName: truth.schemaName },
    );
    assert(missParity.result.ok, `Cache-miss API parity failed: ${missParity.result.reasonCode}`);

    await redis.set(staleKey, '[]', 'EX', 60);
    const stale = await fetchCatalogue();
    const staleParity = evaluateCatalogueParity(
      truth,
      {
        status: stale.response.status,
        contentType: stale.response.headers.get('content-type'),
        body: stale.body,
      },
      { databaseName: truth.databaseName, schemaName: truth.schemaName },
    );
    assert(staleParity.result.ok, `Stale-empty-cache API parity failed: ${staleParity.result.reasonCode}`);

    await redis.set(expiredKey, '[]', 'PX', 1);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert((await redis.exists(expiredKey)) === 0, 'Expired cache fault did not expire');
    const expired = await fetchCatalogue();
    const expiredParity = evaluateCatalogueParity(
      truth,
      {
        status: expired.response.status,
        contentType: expired.response.headers.get('content-type'),
        body: expired.body,
      },
      { databaseName: truth.databaseName, schemaName: truth.schemaName },
    );
    assert(expiredParity.result.ok, `Expired-cache API parity failed: ${expiredParity.result.reasonCode}`);

    await redis.del(staleKey);
    const recovered = await fetchCatalogue();
    const warm = await fetchCatalogue();
    const warmParity = evaluateCatalogueParity(
      truth,
      {
        status: warm.response.status,
        contentType: warm.response.headers.get('content-type'),
        body: warm.body,
      },
      { databaseName: truth.databaseName, schemaName: truth.schemaName },
    );
    assert(warmParity.result.ok, `Warm API parity failed: ${warmParity.result.reasonCode}`);
    assert(
      warmParity.result.apiIdentifierPriceSha256 === coldParity.result.apiIdentifierPriceSha256,
      'Cold/warm API hashes diverged',
    );
    const recoveredParity = evaluateCatalogueParity(
      truth,
      {
        status: recovered.response.status,
        contentType: recovered.response.headers.get('content-type'),
        body: recovered.body,
      },
      { databaseName: truth.databaseName, schemaName: truth.schemaName },
    );
    assert(recoveredParity.result.ok, `Cache-recovery API parity failed: ${recoveredParity.result.reasonCode}`);
    assert(
      [missParity, staleParity, expiredParity, recoveredParity, warmParity].every(
        (observation) =>
          observation.result.apiIdentifierPriceSha256 === coldParity.result.apiIdentifierPriceSha256,
      ),
      'Cache-state matrix changed catalogue identifiers or canonical prices',
    );
    await redis.del(staleKey, expiredKey);
    redisAfter = await redis.dbsize();
  } finally {
    await redis.quit().catch(() => undefined);
  }

  assert(redisBefore === redisAfter, 'Isolated Redis proof residue remains');
  assert(
    hashCatalogueIdentifiers(repositoryObservations) === truth.identifierSetSha256,
    'SQL/repository identifier parity failed',
  );
  assert(
    hashCatalogueIdentifiersAndPrices(repositoryObservations) === truth.identifierPriceSha256,
    'SQL/repository price parity failed',
  );
  assert(
    hashCatalogueIdentifiers(dtoObservations) === truth.identifierSetSha256,
    'SQL/use-case/DTO identifier parity failed',
  );
  assert(
    hashCatalogueIdentifiersAndPrices(dtoObservations) === truth.identifierPriceSha256,
    'SQL/use-case/DTO price parity failed',
  );

  const emptyTruth: IndependentCatalogueTruth = {
    ...truth,
    totalEligible: 0,
    expectedPageCount: 0,
    page: [],
    identifierSetSha256: hashCatalogueIdentifiers([]),
    identifierPriceSha256: hashCatalogueIdentifiersAndPrices([]),
  };
  expectReason(emptyTruth, { success: true, data: [] }, 'CATALOGUE_PARITY_OK');
  expectReason(truth, { success: true, data: [] }, 'CATALOGUE_DB_GT_ZERO_API_ZERO');
  expectReason(truth, { success: true }, 'CATALOGUE_COLLECTION_MISSING');
  expectReason(truth, { success: true, data: { items: [] } }, 'CATALOGUE_COLLECTION_MALFORMED');
  expectReason(truth, null, 'CATALOGUE_RESPONSE_MALFORMED');

  const apiRows = coldParity.products.map((product) => ({ ...product }));
  const idDivergence = apiRows.map((product, index) =>
    index === 0 ? { ...product, id: '00000000-0000-4000-8000-000000000000' } : product,
  );
  const priceDivergence = apiRows.map((product, index) =>
    index === 0
      ? { ...product, retailPriceUgx: Number(product.retailPriceUgx ?? 0) + 1 }
      : product,
  );
  expectReason(truth, { success: true, data: idDivergence }, 'CATALOGUE_IDENTIFIER_DIVERGENCE');
  expectReason(truth, { success: true, data: priceDivergence }, 'CATALOGUE_PRICE_DIVERGENCE');
  expectReason(
    { ...truth, databaseName: 'wrong_database' },
    cold.body,
    'CATALOGUE_DATABASE_TARGET_MISMATCH',
    { databaseName: truth.databaseName, schemaName: truth.schemaName },
  );
  expectReason(
    { ...truth, schemaName: 'wrong_schema' },
    cold.body,
    'CATALOGUE_DATABASE_SCHEMA_MISMATCH',
    { databaseName: truth.databaseName, schemaName: truth.schemaName },
  );

  const after = await protectedCounts();
  for (const key of Object.keys(before)) {
    assert(before[key] === after[key], `${key} changed during read-only catalogue parity proof`);
  }

  return {
    verdict: 'CATALOGUE_PARITY_PROOF_PASS',
    databaseFingerprintSha256: coldParity.result.databaseFingerprintSha256,
    predicateVersion: truth.predicateVersion,
    sqlCount: truth.expectedPageCount,
    repositoryCount: repositoryObservations.length,
    dtoCount: dtoObservations.length,
    apiCount: coldParity.result.apiCount,
    identifierSetSha256: truth.identifierSetSha256,
    identifierPriceSha256: truth.identifierPriceSha256,
    coldWarmParity: true,
    staleEmptyCacheIgnored: true,
    faultInjections: 8,
    cacheMatrix: ['cold', 'miss', 'stale_empty', 'expired', 'recovered', 'warm'],
    providerCalls,
    protectedMutationDelta: 0,
    redisResidue: redisAfter - redisBefore,
  };
}

async function run(): Promise<void> {
  let report: Record<string, unknown> | undefined;
  let failure: unknown;
  try {
    report = await main();
  } catch (error) {
    failure = error;
  } finally {
    try {
      await endDbConnection();
    } catch (error) {
      failure ??= error;
    }
  }

  if (failure) {
    const message = failure instanceof Error ? failure.message : String(failure);
    console.log(JSON.stringify({ verdict: 'CATALOGUE_PARITY_PROOF_FAIL', error: message }));
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(report));
}

void run();
