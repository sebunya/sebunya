import '../config/env';
import { Registry } from '../infrastructure/Registry';
import { endDbConnection } from '../infrastructure/db/client';

/**
 * Approves and applies a staged battery/compatibility import from the host,
 * through the SAME use cases the Back Office buttons call (BatteryImportUseCases
 * approve → apply), with the same four-eyes rule: the approver must be a
 * different admin from the uploader, or the use case refuses. Every step
 * appends the usual immutable battery_import_events rows and the applied
 * records are audited by the battery use cases.
 *
 * Precedent: import-price-list.ts (2026-08) approved the price list the same
 * way with APPROVER_USER_ID.
 *
 *   IMPORT_ID=<session uuid> APPROVER_USER_ID=<second admin uuid> [STEP=approve|apply|both] [DRY_RUN=1] \
 *     npx tsx src/scripts/approve-battery-import.ts
 *
 * DRY_RUN=1 prints the session (status, version, uploader, row counts) and
 * what would happen, and writes nothing. STEP defaults to both.
 */
const uuid = (v: unknown) => /^[0-9a-f-]{36}$/i.test(String(v ?? ''));

async function main(): Promise<void> {
  const importId = String(process.env.IMPORT_ID ?? '').trim();
  const approverId = String(process.env.APPROVER_USER_ID ?? '').trim();
  const step = String(process.env.STEP ?? 'both').trim().toLowerCase();
  const dryRun = process.env.DRY_RUN === '1';
  if (!uuid(importId)) throw new Error('IMPORT_ID must be the import session uuid.');
  if (!uuid(approverId)) throw new Error('APPROVER_USER_ID must be the approving admin uuid.');
  if (!['approve', 'apply', 'both'].includes(step)) throw new Error('STEP must be approve, apply or both.');

  const pim = Registry.getInstance().batteryImportUseCases;
  const show = async (label: string) => {
    const { session: s } = await pim.detail(importId);
    console.log(`${label}: "${s.name}" type=${s.importType} status=${s.status} v${s.version} uploader=${s.createdBy} rows total=${s.totalRows} valid=${s.validRows} invalid=${s.invalidRows} held=${s.heldRows} excluded=${s.excludedRows} applied=${s.appliedRows} failed=${s.failedRows}`);
    return s;
  };

  let s = await show('session');
  if (s.createdBy === approverId) throw new Error('APPROVER_USER_ID is the uploader. Four eyes: a different admin must approve.');

  if (step !== 'apply') {
    if (s.status !== 'READY_FOR_APPROVAL') console.log(`approve: skipped, status is ${s.status} (needs READY_FOR_APPROVAL)`);
    else if (dryRun) console.log('approve: WOULD approve (DRY RUN)');
    else {
      await pim.approve({ id: importId, expectedVersion: s.version, actorId: approverId, decision: 'APPROVED', reason: 'Approved from the host by a second administrator (approve-battery-import.ts).' });
      s = await show('approved');
    }
  }

  if (step !== 'approve') {
    if (s.status !== 'APPROVED') console.log(`apply: ${dryRun && step !== 'apply' ? 'would follow the approval' : `skipped, status is ${s.status} (needs APPROVED)`}`);
    else if (dryRun) console.log('apply: WOULD apply (DRY RUN)');
    else {
      // No cost or price rights are claimed here: a compatibility import needs neither.
      await pim.apply({ id: importId, expectedVersion: s.version, actorId: approverId, canRecordCost: false, canPrice: false });
      s = await show('applied');
    }
  }
  if (dryRun) console.log('DRY RUN — nothing written');
}
main().then(() => endDbConnection()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await endDbConnection(); process.exit(1); });
