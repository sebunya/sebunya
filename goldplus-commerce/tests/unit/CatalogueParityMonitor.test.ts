import { describe, expect, it } from 'vitest';
import {
  evaluateCatalogueParity,
  hashCatalogueIdentifiers,
  hashCatalogueIdentifiersAndPrices,
  type CatalogueObservation,
  type IndependentCatalogueTruth,
} from '../../apps/api/src/infrastructure/scheduler/SyntheticMonitor';

const page: CatalogueObservation[] = [
  { id: 'product-a', slug: 'product-a', canonicalPriceUgx: 50_000 },
  { id: 'product-b', slug: 'product-b', canonicalPriceUgx: 80_000 },
];

const truth = (rows: CatalogueObservation[] = page): IndependentCatalogueTruth => ({
  databaseName: 'goldplus',
  schemaName: 'public',
  searchPath: '"$user", public',
  predicateVersion: 'public-catalogue-v1:test',
  totalEligible: rows.length,
  expectedPageCount: rows.length,
  page: rows,
  identifierSetSha256: hashCatalogueIdentifiers(rows),
  identifierPriceSha256: hashCatalogueIdentifiersAndPrices(rows),
});

const productBody = (rows: CatalogueObservation[] = page) => ({
  success: true,
  data: rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    retailPriceUgx: row.canonicalPriceUgx,
  })),
  meta: { requestId: 'test-request' },
});

const http = (body: unknown, overrides: { status?: number; contentType?: string | null } = {}) => ({
  status: overrides.status ?? 200,
  contentType: overrides.contentType === undefined ? 'application/json; charset=UTF-8' : overrides.contentType,
  body,
});

const expectedTarget = { databaseName: 'goldplus', schemaName: 'public' };

describe('catalogue SQL/API parity monitor', () => {
  it('accepts the actual public products ApiResponse array schema', () => {
    const result = evaluateCatalogueParity(truth(), http(productBody()), expectedTarget);

    expect(result.result.ok).toBe(true);
    expect(result.result.reasonCode).toBe('CATALOGUE_PARITY_OK');
    expect(result.result.firstDivergentLayer).toBe('none');
    expect(result.result.sqlIdentifierSetSha256).toBe(result.result.apiIdentifierSetSha256);
    expect(result.result.sqlIdentifierPriceSha256).toBe(result.result.apiIdentifierPriceSha256);
  });

  it('accepts a legitimate empty catalogue only when SQL is also empty', () => {
    const result = evaluateCatalogueParity(truth([]), http(productBody([])), expectedTarget);

    expect(result.result.reasonCode).toBe('CATALOGUE_PARITY_OK');
    expect(result.result.sqlCount).toBe(0);
    expect(result.result.apiCount).toBe(0);
  });

  it('detects the original DB-positive/API-empty failure class', () => {
    const result = evaluateCatalogueParity(truth(), http(productBody([])), expectedTarget);

    expect(result.result.reasonCode).toBe('CATALOGUE_DB_GT_ZERO_API_ZERO');
    expect(result.result.firstDivergentLayer).toBe('api_collection');
  });

  it('rejects the stale data.items parser contract as a malformed collection', () => {
    const result = evaluateCatalogueParity(
      truth(),
      http({ success: true, data: { items: productBody().data } }),
      expectedTarget,
    );

    expect(result.result.reasonCode).toBe('CATALOGUE_COLLECTION_MALFORMED');
    expect(result.result.firstDivergentLayer).toBe('api_schema');
  });

  it('detects a missing collection before comparing identifiers', () => {
    const result = evaluateCatalogueParity(truth(), http({ success: true }), expectedTarget);

    expect(result.result.reasonCode).toBe('CATALOGUE_COLLECTION_MISSING');
    expect(result.result.firstDivergentLayer).toBe('api_schema');
  });

  it.each([
    ['non-object body', null],
    ['negative envelope', { success: false, data: [] }],
    ['malformed product', { success: true, data: [{ id: 'product-a', slug: '', retailPriceUgx: 50_000 }] }],
  ])('detects malformed response: %s', (_label, body) => {
    const result = evaluateCatalogueParity(truth(), http(body), expectedTarget);

    expect(['CATALOGUE_RESPONSE_MALFORMED', 'CATALOGUE_COLLECTION_MALFORMED']).toContain(
      result.result.reasonCode,
    );
  });

  it('detects identifier divergence', () => {
    const divergent = [page[0], { ...page[1], id: 'product-c', slug: 'product-c' }];
    const result = evaluateCatalogueParity(truth(), http(productBody(divergent)), expectedTarget);

    expect(result.result.reasonCode).toBe('CATALOGUE_IDENTIFIER_DIVERGENCE');
    expect(result.result.firstDivergentLayer).toBe('api_collection');
  });

  it('detects canonical price divergence after identifier parity', () => {
    const divergent = [page[0], { ...page[1], canonicalPriceUgx: 80_001 }];
    const result = evaluateCatalogueParity(truth(), http(productBody(divergent)), expectedTarget);

    expect(result.result.reasonCode).toBe('CATALOGUE_PRICE_DIVERGENCE');
    expect(result.result.firstDivergentLayer).toBe('api_collection');
  });

  it('rejects wrong database and schema fingerprints before API parsing', () => {
    const wrongDatabase = evaluateCatalogueParity(
      { ...truth(), databaseName: 'scratch' },
      http(productBody()),
      expectedTarget,
    );
    const wrongSchema = evaluateCatalogueParity(
      { ...truth(), schemaName: 'shadow' },
      http(productBody()),
      expectedTarget,
    );

    expect(wrongDatabase.result.reasonCode).toBe('CATALOGUE_DATABASE_TARGET_MISMATCH');
    expect(wrongDatabase.result.firstDivergentLayer).toBe('database_target');
    expect(wrongSchema.result.reasonCode).toBe('CATALOGUE_DATABASE_SCHEMA_MISMATCH');
    expect(wrongSchema.result.firstDivergentLayer).toBe('database_schema');
  });

  it('validates status and content type before the response schema', () => {
    const badStatus = evaluateCatalogueParity(truth(), http(productBody(), { status: 503 }), expectedTarget);
    const badType = evaluateCatalogueParity(
      truth(),
      http(productBody(), { contentType: 'text/html' }),
      expectedTarget,
    );

    expect(badStatus.result.reasonCode).toBe('CATALOGUE_HTTP_STATUS_INVALID');
    expect(badStatus.result.firstDivergentLayer).toBe('api_http');
    expect(badType.result.reasonCode).toBe('CATALOGUE_CONTENT_TYPE_INVALID');
    expect(badType.result.firstDivergentLayer).toBe('api_http');
  });
});
