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
 *   IMPORT_SESSION_ID=<uuid> ACTOR_USER_ID=<second admin uuid> [ENABLE_AWAITING=1] [DRY_RUN=1] \
 *     npx tsx src/scripts/publish-supplier-listed-claims.ts
 *
 * ENABLE_AWAITING=1 turns the finder setting on first (through the finder
 * config use case, versioned and audited) if it is off.
 */
const uuid = (v: unknown) => /^[0-9a-f-]{36}$/i.test(String(v ?? ''));

async function main(): Promise<void> {
  const sessionId = String(process.env.IMPORT_SESSION_ID ?? '').trim();
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  const dryRun = process.env.DRY_RUN === '1';
  if (!uuid(sessionId)) throw new Error('IMPORT_SESSION_ID must be the import session uuid.');
  if (!uuid(actorId)) throw new Error('ACTOR_USER_ID must be the publishing admin uuid (not the uploader).');

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

  const drafts = (await r.batteryCompatibilityRepo.list({ workflowStatus: 'DRAFT', evidenceStatus: 'SUPPLIER_LISTED', limit: 5000 }))
    .filter((c) => c.sourceImportSessionId === sessionId);
  console.log(`${drafts.length} draft supplier-listed claim(s) from import ${sessionId}`);
  let published = 0, failed = 0;
  for (const claim of drafts) {
    const label = `${claim.sourceReference ?? claim.id}`;
    if (claim.createdBy === actorId) { failed += 1; console.log(`  ${label}: SKIP — actor is the creator`); continue; }
    if (dryRun) continue;
    try {
      await r.batteryCompatibilityUseCases.transition(claim.id, 'SUBMIT', actorId);
      await r.batteryCompatibilityUseCases.transition(claim.id, 'PUBLISH', actorId, { allowAwaiting: true, reason: 'Published as awaiting verification (owner policy 2026-10-12).' });
      published += 1;
    } catch (e) {
      failed += 1;
      console.log(`  ${label}: FAILED — ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  console.log(`${drafts.length} claims: published ${published}, failed ${failed}${dryRun ? ' (DRY RUN — nothing written)' : ''}`);
  if (failed > 0) process.exitCode = 1;
}
main().then(() => endDbConnection()).catch(async (e) => { console.error(e instanceof Error ? e.message : e); await endDbConnection(); process.exit(1); });
