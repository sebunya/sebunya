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
  if (rows.length > 0) console.log('SHAPE=' + JSON.stringify(rows[0]));
  for (const m of rows) console.log('ROW=' + JSON.stringify(m));
}

main()
  .then(() => endDbConnection())
  .catch(async (err) => {
    console.error('FAILED', err);
    await endDbConnection();
    process.exitCode = 1;
  });
