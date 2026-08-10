import '../config/env';
import { ApproveModuleActivationUseCase } from '../application/use-cases/control-centre/ModuleActivationApprovalUseCases';
import { drizzleModuleApprovalRepository } from '../infrastructure/control-centre/DrizzleControlCentreProbes';
import { Registry } from '../infrastructure/Registry';
import { endDbConnection } from '../infrastructure/db/client';
import { randomUUID } from 'node:crypto';

/**
 * Governed module-activation approvals (operator-delegated, 2026-08-10).
 *
 * Drives the REAL ApproveModuleActivationUseCase — same ledger row, same audit
 * record, same invariants an admin click produces. Exists because the owner
 * directed activation of the named programmes while the Trust Centre's
 * approval probe was broken (the driver-shape bug made every approval read as
 * absent). Idempotent: an already-approved module is reported and skipped.
 *
 * Usage:
 *   ACTOR_USER_ID=<owner uuid> MODULES=loyalty,surveys,... npx tsx src/scripts/approve-module-activations.ts
 */
async function main(): Promise<void> {
  const actorId = String(process.env.ACTOR_USER_ID ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(actorId)) throw new Error('ACTOR_USER_ID must be the approving owner/admin uuid.');
  const modules = String(process.env.MODULES ?? '').split(',').map((m) => m.trim()).filter(Boolean);
  if (modules.length === 0) throw new Error('MODULES must list at least one module key.');

  const approve = new ApproveModuleActivationUseCase(
    drizzleModuleApprovalRepository,
    Registry.getInstance().createAuditLogUseCase,
  );

  for (const moduleKey of modules) {
    const result = await approve.execute({
      moduleKey,
      actorId,
      reason: 'Owner-directed activation: ledger and rules verified operational; programme approved to issue value.',
      approvalReference: 'OWNER-DIRECTIVE-2026-08-10-trust-centre-activation',
      traceId: randomUUID(),
    });
    console.log(`${moduleKey}: ${result.ok ? 'APPROVED' : `${result.code} — ${result.message}`}`);
  }
}

main()
  .then(async () => { await endDbConnection(); process.exit(0); })
  .catch(async (error) => { console.error('FAILED:', error instanceof Error ? error.message : error); await endDbConnection(); process.exit(1); });
