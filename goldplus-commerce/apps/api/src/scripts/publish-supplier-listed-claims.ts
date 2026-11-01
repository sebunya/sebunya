import '../config/env';
import { Registry } from '../infrastructure/Registry';
import { endDbConnection } from '../infrastructure/db/client';

/**
 * Publishes the DRAFT, supplier-listed compatibility claims of one import
 * session as "awaiting verification": each claim is SUBMITTED and then
 * PUBLISHED through BatteryCompatibilityUseCases.transition, the same path and
 * audit as the admin buttons. The domain rule allows this only while the
 * finder is set to show fits awaiting verification, and only for an actor who
 * is not the claim's creator (the import's uploader). The public label on
 * every such fit says the shop has not checked it yet; verifying a claim
 * later upgrades it in place.
 *
 *   IMPORT_SESSION_ID=<uuid> ACTOR_USER_ID=<second admin uuid> [UPLOADER_USER_ID=<uploader uuid>] \
 *     [MODE=publish|resubmit] [ENABLE_AWAITING=1] [DRY_RUN=1] npx tsx src/scripts/publish-supplier-listed-claims.ts
 *
 * Who submits matters: verification later refuses BOTH the creator and the
 * submitter, so with UPLOADER_USER_ID set the claims are submitted by their
 * creator (the uploader) and only published by ACTOR_USER_ID — leaving the
 * actor free to verify them afterwards. MODE=resubmit repairs claims already
 * live that the actor submitted (reopen → submit as uploader → publish again).
 * ENABLE_AWAITING=1 turns the finder setting on first (versioned, audited).
 */
const uuid = (v: unknown) => /^[0-9a-f-]{36}$/i.test(String(v ?? ''));

async function main(): Promise<void> {
  const sessionId = String(process.env.IMPORT_SESSION_ID ?? '').trim();
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  const uploaderId = String(process.env.UPLOADER_USER_ID ?? '').trim();
  const mode = process.env.MODE === 'resubmit' ? 'resubmit' : 'publish';
  const dryRun = process.env.DRY_RUN === '1';
  if (!uuid(sessionId)) throw new Error('IMPORT_SESSION_ID must be the import session uuid.');
  if (!uuid(actorId)) throw new Error('ACTOR_USER_ID must be the publishing admin uuid (not the uploader).');
  if (uploaderId && !uuid(uploaderId)) throw new Error('UPLOADER_USER_ID must be a uuid.');
  if (uploaderId && uploaderId === actorId) throw new Error('UPLOADER_USER_ID must differ from ACTOR_USER_ID.');
  if (mode === 'resubmit' && !uploaderId) throw new Error('MODE=resubmit needs UPLOADER_USER_ID.');

  const r = Registry.getInstance();
  let { config, version } = await r.batteryFinderUseCases.configWithVersion();
  console.log(`finder setting showAwaitingVerification=${config.showAwaitingVerification} (config v${version})`);
  if (!config.showAwaitingVerification) {
    if (process.env.ENABLE_AWAITING !== '1') throw new Error('The finder is not set to show fits awaiting verification. Re-run with ENABLE_AWAITING=1 to turn it on, or enable it in Admin → Battery finder.');
    if (dryRun) console.log('would enable showAwaitingVerification (DRY RUN)');
    else {
      await r.batteryFinderUseCases.saveConfig({ ...config, showAwaitingVerification: true }, version, actorId);
      ({ config, version } = await r.batteryFinderUseCases.configWithVersion());
      console.log(`enabled showAwaitingVerification (config v${version})`);
    }
  }

  const uc = r.batteryCompatibilityUseCases;
  const fromSession = <T extends { sourceImportSessionId: string | null }>(rows: T[]): T[] => rows.filter((c) => c.sourceImportSessionId === sessionId);
  const claims = mode === 'resubmit'
    ? fromSession(await r.batteryCompatibilityRepo.list({ workflowStatus: 'ACTIVE', evidenceStatus: 'SUPPLIER_LISTED', limit: 5000 })).filter((c) => c.submittedBy === actorId)
    : fromSession(await r.batteryCompatibilityRepo.list({ workflowStatus: 'DRAFT', evidenceStatus: 'SUPPLIER_LISTED', limit: 5000 }));
  console.log(`${claims.length} ${mode === 'resubmit' ? 'live awaiting claim(s) submitted by the actor' : 'draft supplier-listed claim(s)'} from import ${sessionId}`);
  let published = 0, failed = 0;
  for (const claim of claims) {
    const label = `${claim.sourceReference ?? claim.id}`;
    if (claim.createdBy === actorId) { failed += 1; console.log(`  ${label}: SKIP — actor is the creator`); continue; }
    if (uploaderId && claim.createdBy !== uploaderId) { failed += 1; console.log(`  ${label}: SKIP — created by ${claim.createdBy}, not UPLOADER_USER_ID`); continue; }
    if (dryRun) continue;
    try {
      if (mode === 'resubmit') await uc.transition(claim.id, 'REOPEN', uploaderId, { reason: 'Resubmitted by the uploader so a second person can verify (2026-10-12).' });
      await uc.transition(claim.id, 'SUBMIT', uploaderId || actorId);
      await uc.transition(claim.id, 'PUBLISH', actorId, { allowAwaiting: true, reason: 'Published as awaiting verification (owner policy 2026-10-12).' });
      published += 1;
    } catch (e) {
      failed += 1;
      console.log(`  ${label}: FAILED — ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`${claims.length} claims: published ${published}, failed ${failed}${dryRun ? ' (DRY RUN — nothing written)' : ''}`);
  if (failed > 0) process.exitCode = 1;
}
main().then(() => endDbConnection()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await endDbConnection(); process.exit(1); });
