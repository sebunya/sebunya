import { sql, type SQL } from 'drizzle-orm';

/**
 * The report-side half of the historical exhaust exclusion (0155): the same
 * predicate the analysis.*_human views use, for queries built with drizzle on
 * the source table. `ANALYSIS_EXCLUSIONS=off` is the rollback switch (reports
 * then read every row again); anything else keeps the exclusion on.
 */
export function analysisExclusionsEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return (env.ANALYSIS_EXCLUSIONS ?? '').trim().toLowerCase() !== 'off';
}

export function humanTrafficOnly(sourceTable: 'recommendation_events' | 'experience_profiles', idColumn: SQL | unknown): SQL {
  if (!analysisExclusionsEnabled()) return sql`true`;
  return sql`not exists (select 1 from analysis.traffic_exclusion_marks m where m.source_table = ${sourceTable} and m.row_id = ${idColumn} and m.reverted_at is null)`;
}
