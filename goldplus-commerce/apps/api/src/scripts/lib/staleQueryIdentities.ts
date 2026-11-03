/**
 * Which seo_queries rows prune-stale-query-identities may delete. Pure.
 *
 * A row is stale when re-normalising its raw query no longer gives its stored
 * normalized_query. It may be deleted only when its correct identity is held
 * by a row that is itself CORRECT — a row that is stale too is deleted in the
 * same pass, so it cannot vouch for anything.
 */
export interface QueryIdentityRow { id: string; query: string; normalized_query: string }
export interface PrunePlan {
  stale: Array<{ row: QueryIdentityRow; correct: string }>;
  skipped: Array<{ row: QueryIdentityRow; correct: string }>;
}

export function planStaleQueryPrune(rows: QueryIdentityRow[], normalize: (query: string) => string): PrunePlan {
  const correctOf = new Map(rows.map((r) => [r.id, normalize(r.query)]));
  const kept = new Set(rows.filter((r) => correctOf.get(r.id) === r.normalized_query).map((r) => r.normalized_query));
  const plan: PrunePlan = { stale: [], skipped: [] };
  for (const row of rows) {
    const correct = correctOf.get(row.id)!;
    if (correct === row.normalized_query) continue;
    (kept.has(correct) ? plan.stale : plan.skipped).push({ row, correct });
  }
  return plan;
}
