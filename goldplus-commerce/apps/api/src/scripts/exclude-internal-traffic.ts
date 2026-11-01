import '../config/env';
import { endDbConnection } from '../infrastructure/db/client';
import { TrafficExclusionStore } from '../infrastructure/first-party/TrafficExclusionStore';
import { EXCLUSION_RULES, resolveRuleSelection } from '../domain/first-party/TrafficExclusion';
import { parseExclusionArgs } from './lib/firstPartyOpsArgs';

/**
 * Mark our own monitor / SSR / probe exhaust as excluded from ANALYSIS
 * (docs/first-party/README.md, migration 0155). Nothing is deleted or updated
 * in recommendation_events or experience_profiles; marks live in
 * analysis.traffic_exclusion_marks and every run can be reverted.
 *
 * DRY RUN BY DEFAULT — prints what each rule would mark and what it would cost.
 *
 *   npx tsx src/scripts/exclude-internal-traffic.ts                      # dry run, default rules
 *   npx tsx src/scripts/exclude-internal-traffic.ts --rules=SINGLE_HIT_PROFILE,EVENT_OF_EXCLUDED_PROFILE
 *   npx tsx src/scripts/exclude-internal-traffic.ts --from=2026-08-01 --to=2026-09-21
 *   npx tsx src/scripts/exclude-internal-traffic.ts --apply [--batch=5000] [--pause-ms=200] [--actor=name]
 *   npx tsx src/scripts/exclude-internal-traffic.ts --revert=<run id> [--apply]   # revert is dry unless --apply
 *   npx tsx src/scripts/exclude-internal-traffic.ts --summary
 *
 * Rollback for reports without touching marks: ANALYSIS_EXCLUSIONS=off.
 */
async function main(): Promise<number> {
  const args = parseExclusionArgs(process.argv.slice(2));
  if (args.errors.length) {
    console.error(JSON.stringify({ ok: false, errors: args.errors }));
    return 2;
  }
  const store = new TrafficExclusionStore();

  if (args.mode === 'SUMMARY') {
    console.log(JSON.stringify(await store.summary(), null, 2));
    return 0;
  }
  if (args.mode === 'REVERT') {
    const dryRun = !args.applyRevert;
    const r = await store.revert(args.revertRunId!, { actor: args.actor, dryRun });
    console.log(JSON.stringify({ mode: dryRun ? 'REVERT_DRY_RUN' : 'REVERT', ...r }, null, 2));
    return 0;
  }

  const selection = resolveRuleSelection(args.rules);
  if (!selection.ok) {
    console.error(JSON.stringify({ ok: false, unknownRules: selection.unknown, knownRules: EXCLUSION_RULES.map((r) => r.key) }));
    return 2;
  }
  const window = { from: args.from, to: args.to };
  const counts = await store.count(selection.rules, window);
  console.log(JSON.stringify({
    mode: args.mode,
    window: { from: args.from?.toISOString() ?? null, to: args.to?.toISOString() ?? null },
    rules: selection.rules.map((r) => ({ key: r.key, table: r.table, description: r.description })),
    counts,
  }, null, 2));
  if (args.mode === 'DRY_RUN') {
    console.log('Dry run: nothing was written. Re-run with --apply to mark these rows.');
    return 0;
  }
  const applied = await store.apply(selection.rules, window, { actor: args.actor, batchSize: args.batchSize, pauseMs: args.pauseMs });
  console.log(JSON.stringify({ applied }, null, 2));
  console.log(`To undo: npx tsx src/scripts/exclude-internal-traffic.ts --revert=${applied.runId} --apply`);
  return 0;
}

main()
  .then(async (code) => { await endDbConnection().catch(() => undefined); process.exit(code); })
  .catch(async (err) => {
    console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    await endDbConnection().catch(() => undefined);
    process.exit(1);
  });
