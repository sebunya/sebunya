import '../config/env';
import { sql } from 'drizzle-orm';
import { db, endDbConnection } from '../infrastructure/db/client';
import { normalizeQuery } from '../application/use-cases/seo-growth/QueryIntelligence';
import { rowsOf } from './lib/scriptHelpers';
import { planStaleQueryPrune, type QueryIdentityRow } from './lib/staleQueryIdentities';

/**
 * Remove seo_queries rows whose stored identity no longer matches the rules.
 *
 * `normalized_query` is computed at INGEST and stored. When a normalisation
 * rule changes — "shopgold" becoming a recognised form of the brand, say — the
 * projection re-reads every observation and writes the CORRECT identity, but
 * the row carrying the old one is never removed. It lingers, keeps forming its
 * own cluster, and keeps being classified UNKNOWN, so a fixed rule appears to
 * have changed nothing.
 *
 * A row is stale when re-normalising its own raw query no longer produces its
 * stored normalized_query. Deleting it is safe: the correct identity already
 * exists (the projection upserts it), and the metrics live in gsc_performance,
 * never here — this table carries identity and provenance only.
 *
 * Refuses to delete a stale row whose correct identity is NOT already held by
 * a correct row (a stale row deleted in the same pass does not count), which
 * would lose the query altogether.
 *
 * Usage: npx tsx src/scripts/prune-stale-query-identities.ts [--apply]
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const all = rowsOf(await db.execute(sql`
    select id::text as id, query, normalized_query from seo_queries
  `)) as unknown as QueryIdentityRow[];
  const plan = planStaleQueryPrune(all, (q) => normalizeQuery(q).normalized);
  for (const { row, correct } of plan.skipped) {
    console.log(`SKIP  "${row.query}": ${row.normalized_query} -> ${correct} (no correct row holds the target identity; would lose the query)`);
  }
  for (const { row, correct } of plan.stale) {
    console.log(`STALE "${row.query}": ${row.normalized_query} -> ${correct}`);
    if (apply) {
      await db.execute(sql`delete from seo_queries where id = ${row.id}::uuid`);
      console.log('  DELETED');
    }
  }
  const stale = plan.stale.length;
  const skipped = plan.skipped.length;

  console.log(`\nrows=${all.length} stale=${stale} skipped=${skipped}${apply ? '' : '  (dry run — pass --apply)'}`);
}

main()
  .then(() => endDbConnection())
  .catch(async (err) => {
    console.error('FAILED', err);
    await endDbConnection();
    process.exitCode = 1;
  });
