import '../config/env';
import { randomUUID } from 'node:crypto';
import { endDbConnection } from '../infrastructure/db/client';
import { DrizzlePhoneHygieneRepository } from '../infrastructure/first-party/DrizzlePhoneHygieneRepository';
import { maskPhone, planPhoneHygiene } from '../domain/first-party/PhoneHygiene';
import { parsePhoneHygieneArgs } from './lib/firstPartyOpsArgs';

/**
 * Phone hygiene (docs/first-party/README.md, migration 0155).
 *
 * Finds customer and user records whose phone is one Ugandan number stored in
 * different shapes (0771…, 256771…, 771…, +256771…), and:
 *   - DRY RUN (default): prints the plan — format changes, numbers stored in
 *     mixed shapes, and PROPOSED MERGES (two or more accounts on one number).
 *   - --apply: rewrites formats to E.164 (+256…) only, each change logged in
 *     phone_normalisation_log with its previous value. It NEVER merges accounts
 *     and never touches a users.phone that would collide with another account.
 *   - --revert=<run id> --apply: puts a run's values back.
 * Proposed merges are for a person to approve (Loyalty → account merge, or the
 * identity conflicts page); this script only lists them. Output masks numbers.
 *
 *   npx tsx src/scripts/phone-hygiene.ts [--show=50]
 *   npx tsx src/scripts/phone-hygiene.ts --apply
 *   npx tsx src/scripts/phone-hygiene.ts --revert=<run id> --apply
 */
async function main(): Promise<number> {
  const args = parsePhoneHygieneArgs(process.argv.slice(2));
  if (args.errors.length) {
    console.error(JSON.stringify({ ok: false, errors: args.errors }));
    return 2;
  }
  const repo = new DrizzlePhoneHygieneRepository();

  if (args.mode === 'REVERT') {
    if (!args.applyRevert) {
      console.log(JSON.stringify({ mode: 'REVERT_DRY_RUN', runId: args.revertRunId, note: 'Add --apply to put this run\'s values back.' }));
      return 0;
    }
    console.log(JSON.stringify({ mode: 'REVERT', runId: args.revertRunId, ...(await repo.revertRun(args.revertRunId!)) }));
    return 0;
  }

  const plan = planPhoneHygiene(await repo.loadAll());
  const byTable: Record<string, number> = {};
  for (const n of plan.normalisations) byTable[`${n.table}.${n.column}`] = (byTable[`${n.table}.${n.column}`] ?? 0) + 1;
  console.log(JSON.stringify({
    mode: args.mode,
    scanned: plan.scanned,
    alreadyE164: plan.alreadyNormalised,
    formatChanges: plan.normalisations.length,
    formatChangesByColumn: byTable,
    blockedBecauseTwoAccountsShareTheNumber: plan.blocked.length,
    unparseable: plan.unparseable.length,
    numbersInMixedFormats: plan.mixedFormatGroups.length,
    mixedFormatExamples: plan.mixedFormatGroups.slice(0, 10).map((g) => ({ number: g.masked, shapes: g.shapes, records: g.records })),
    proposedMerges: plan.proposedMerges.slice(0, args.showMerges),
    proposedMergeCount: plan.proposedMerges.length,
    note: 'Proposed merges are NOT applied. A person decides which account survives.',
  }, null, 2));
  if (args.mode === 'DRY_RUN') {
    console.log('Dry run: nothing was written. Re-run with --apply to normalise formats (merges are never applied).');
    return 0;
  }
  const runId = randomUUID();
  let applied = 0;
  let changedMeanwhile = 0;
  let failed = 0;
  for (const n of plan.normalisations) {
    try {
      if (await repo.applyNormalisation(runId, n)) applied++;
      else changedMeanwhile++;
    } catch (err) {
      failed++;
      console.error(JSON.stringify({ table: n.table, column: n.column, from: maskPhone(n.from), error: err instanceof Error ? err.message.slice(0, 160) : 'failed' }));
    }
  }
  console.log(JSON.stringify({ runId, applied, changedMeanwhile, failed, undo: `npx tsx src/scripts/phone-hygiene.ts --revert=${runId} --apply` }, null, 2));
  return failed ? 1 : 0;
}

main()
  .then(async (code) => { await endDbConnection().catch(() => undefined); process.exit(code); })
  .catch(async (err) => {
    console.error(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
    await endDbConnection().catch(() => undefined);
    process.exit(1);
  });
