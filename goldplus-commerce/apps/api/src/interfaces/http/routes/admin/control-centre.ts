import { Hono } from 'hono';
import { ApiResponse, PERMISSIONS, CONTROL_CENTRE_MODULES } from '@goldplus/shared';
import { logger } from '../../../../infrastructure/logging/logger';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import {
  drizzleApprovalProbe,
  drizzleDependencyProbe,
  envProviderConfigProbe,
  createRouteMountProbe,
} from '../../../../infrastructure/control-centre/DrizzleControlCentreProbes';
import {
  EvaluateModuleReadinessUseCase,
  type ControlCentreReadinessSummary,
} from '../../../../application/use-cases/control-centre/EvaluateModuleReadinessUseCase';

// audit-exempt: read-only readiness aggregation performs no writes
const routes = new Hono();

routes.use('*', authMiddleware);

let mountedPrefixes: readonly string[] = [];

/** Called by the app composition root once every router is mounted. */
export function registerMountedPrefixes(prefixes: readonly string[]): void {
  mountedPrefixes = prefixes;
}

const VALID_CATEGORIES = new Set(['TRUST_CENTRE', 'COMMERCE_OS', 'READINESS']);

/**
 * GET /admin/control-centre/modules
 * Aggregated, computed readiness for every Control Centre and Commerce OS card.
 */
routes.get('/modules', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const traceId = c.get('traceId') ?? crypto.randomUUID();
  const actorPermissions = (c.get('user')?.permissions as string[] | undefined) ?? [];
  const categoryParam = c.req.query('category');

  if (categoryParam && !VALID_CATEGORIES.has(categoryParam)) {
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'INVALID_CATEGORY', message: `Unknown category "${categoryParam}".` },
    };
    return c.json(res, 400);
  }

  try {
    const useCase = new EvaluateModuleReadinessUseCase(
      drizzleDependencyProbe,
      createRouteMountProbe(mountedPrefixes),
      envProviderConfigProbe,
      drizzleApprovalProbe,
    );

    const summary = await useCase.execute({
      actorPermissions,
      traceId,
      category: categoryParam as 'TRUST_CENTRE' | 'COMMERCE_OS' | 'READINESS' | undefined,
    });

    const res: ApiResponse<ControlCentreReadinessSummary> = { success: true, data: summary };
    return c.json(res, 200);
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error), traceId },
      '[ControlCentre] readiness aggregation failed',
    );
    const res: ApiResponse<never> = {
      success: false,
      error: {
        code: 'MODULE_READINESS_UNAVAILABLE',
        message: 'Module readiness could not be computed.',
      },
    };
    return c.json(res, 503);
  }
});

/**
 * GET /admin/control-centre/registry
 * The declaration itself, for tooling and contract tests. Contains no statuses.
 */
routes.get('/registry', requirePermissions([PERMISSIONS.REPORTS_READ]), (c) => {
  const res: ApiResponse<{ modules: typeof CONTROL_CENTRE_MODULES }> = {
    success: true,
    data: { modules: CONTROL_CENTRE_MODULES },
  };
  return c.json(res, 200);
});

export default routes;
