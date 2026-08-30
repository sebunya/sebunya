import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The synthetic monitor compares an independent SQL read against the public
 * /products response and hashes both. That comparison is only meaningful if
 * both sides select the SAME rows — which means the same predicate AND a total
 * order. Both sides previously took a LIMIT with no ORDER BY and agreed only
 * because Postgres happened to return rows in the same physical order.
 */
const ROOT = resolve(__dirname, '../..');
const monitor = readFileSync(resolve(ROOT, 'apps/api/src/infrastructure/scheduler/SyntheticMonitor.ts'), 'utf8');
const repo = readFileSync(
  resolve(ROOT, 'apps/api/src/infrastructure/db/repositories/DrizzleProductRepository.ts'),
  'utf8',
);
const truth = monitor.slice(monitor.indexOf('export async function loadIndependentCatalogueTruth'));

describe('the monitor selects the same rows as the route it verifies', () => {
  it('the SQL page is totally ordered', () => {
    // Without this, more eligible products than the page size means the two
    // sides compare DIFFERENT subsets and parity can never hold.
    expect(truth).toMatch(/order by p\.created_at desc, p\.id asc/);
  });

  it('and the route it checks uses that same order', () => {
    const block = repo.slice(repo.indexOf('async findPublicViewList'));
    expect(block).toMatch(/orderBy: \[desc\(products\.createdAt\), asc\(products\.id\)\]/);
  });

  it('both sides apply the active filter, not approval alone', () => {
    // The route filters approved AND active; checking approval alone would
    // raise a false CRITICAL the first time a product is deactivated.
    expect(truth.match(/and p\.active = true/g)?.length).toBe(2); // count + page
    const routeBlock = repo.slice(repo.indexOf('async findPublicViewList'));
    expect(routeBlock).toMatch(/eq\(products\.approvalStatus, 'approved'\)/);
    expect(routeBlock).toMatch(/eq\(products\.active, true\)/);
  });

  it('the recorded predicate describes what is actually run', () => {
    // The version string is the operator-facing statement of the check; it
    // must not claim a predicate the query no longer uses.
    const version = monitor.slice(monitor.indexOf('PUBLIC_CATALOGUE_PREDICATE_VERSION ='), monitor.indexOf('export type CatalogueParityReasonCode'));
    expect(version).toContain('active=true');
    expect(version).toContain('order=created_at desc,id asc');
    expect(version).toContain('public-catalogue-v2');
  });
});
