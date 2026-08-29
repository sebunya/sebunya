import '../config/env';
import { PERMISSIONS } from '@goldplus/shared';
import { endDbConnection } from '../infrastructure/db/client';
import {
  drizzleApprovalProbe,
  drizzleDependencyProbe,
  envProviderConfigProbe,
  createRouteMountProbe,
} from '../infrastructure/control-centre/DrizzleControlCentreProbes';
import { EvaluateModuleReadinessUseCase } from '../application/use-cases/control-centre/EvaluateModuleReadinessUseCase';
import { MOUNTED_API_PREFIXES as MOUNTED_PREFIXES } from '../interfaces/http/app';
// Importing the app registers the real mounted prefixes with the probe.
import '../interfaces/http/app';

/**
 * The Trust Centre's own readiness verdict for EVERY module, printed.
 *
 * Same four probes the admin console uses, driven directly so the report does
 * not need an admin session. Read-only. Run with every permission so nothing is
 * filtered out of the answer.
 *
 * Usage: npx tsx src/scripts/admin-readiness-report.ts
 */
async function main(): Promise<void> {
  const useCase = new EvaluateModuleReadinessUseCase(
    drizzleDependencyProbe,
    createRouteMountProbe(MOUNTED_PREFIXES),
    envProviderConfigProbe,
    drizzleApprovalProbe,
  );

  const summary = await useCase.execute({
    actorPermissions: Object.values(PERMISSIONS),
    traceId: 'readiness-report',
  });

  const rows = (summary as any).modules ?? [];
  console.log(`MODULES=${rows.length}`);
  for (const m of rows) {
    console.log(
      [
        String(m.key ?? m.id ?? '?').padEnd(30),
        `service=${String(m.serviceState ?? m.service ?? '?').padEnd(12)}`,
        `access=${String(m.accessState ?? m.access ?? '?').padEnd(11)}`,
        `activation=${String(m.activationState ?? m.activation ?? '?').padEnd(16)}`,
        m.blockers?.length ? `blockers=${JSON.stringify(m.blockers).slice(0, 120)}` : '',
      ].join(' '),
    );
  }
}



main()
  .then(() => endDbConnection())
  .catch(async (err) => {
    console.error('FAILED', err);
    await endDbConnection();
    process.exitCode = 1;
  });
