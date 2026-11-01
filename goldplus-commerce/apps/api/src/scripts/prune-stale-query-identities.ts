import '../config/env';
import { sql } from 'drizzle-orm';
import { db, endDbConnection } from '../infrastructure/db/client';
import { normalizeQuery } from '../application/use-cases/seo-growth/QueryIntelligence';

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
 * Refuses to delete a stale row whose correct identity is NOT already present,
 * which would lose the query altogether.
 *
 * Usage: npx tsx src/scripts/prune-stale-query-identities.ts [--apply]
 */
async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  const rows = (await db.execute(sql`
    select id::text as id, query, normalized_query from seo_queries
  `)) as unknown as Array<{ id: string; query: string; normalized_query: string }>;
  const all = Array.isArray(rows) ? rows : (rows as { rows?: typeof rows }).rows ?? [];

  const live = new Set(all.map((r) => r.normalized_query));
  let stale = 0;
  let skipped = 0;

  for (const r of all) {
    const correct = normalizeQuery(r.query).normalized;
    if (correct === r.normalized_query) continue;

    if (!live.has(correct)) {
      skipped += 1;
      console.log(`SKIP  "${r.query}": ${r.normalized_query} -> ${correct} (target identity absent; would lose the query)`);
      continue;
    }
    stale += 1;
    console.log(`STALE "${r.query}": ${r.normalized_query} -> ${correct}`);
    if (apply) {
      await db.execute(sql`delete from seo_queries where id = ${r.id}::uuid`);
      console.log('  DELETED');
    }
  }

  console.log(`\nrows=${all.length} stale=${stale} skipped=${skipped}${apply ? '' : '  (dry run — pass --apply)'}`);
}

main()
  .then(() => endDbConnection())
  .catch(async (err) => {
    console.error('FAILED', err);
    await endDbConnection();
    process.exitCode = 1;
  });
