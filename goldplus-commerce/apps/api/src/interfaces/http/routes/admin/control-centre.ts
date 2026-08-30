import { Hono } from 'hono';
import { ApiResponse, PERMISSIONS, CONTROL_CENTRE_MODULES } from '@goldplus/shared';
import { logger } from '../../../../infrastructure/logging/logger';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';
import { CreateAuditLogUseCase } from '../../../../application/use-cases/audit/CreateAuditLogUseCase';
import {
  ApproveModuleActivationUseCase,
  ListModuleApprovalsUseCase,
  RevokeModuleActivationUseCase,
} from '../../../../application/use-cases/control-centre/ModuleActivationApprovalUseCases';
import {
  drizzleModuleApprovalRepository,
  drizzleApprovalProbe,
  drizzleDependencyProbe,
  drizzleHealthProbe,
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
  // The context has no typed traceId, so take the inbound correlation id and fall
  // back to a fresh one; every module result carries it for cross-log stitching.
  const traceId = c.req.header('x-correlation-id') ?? crypto.randomUUID();
  const actorPermissions = c.get('user')?.permissions ?? [];
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
      undefined,
      undefined,
      drizzleHealthProbe,
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

/**
 * Approval administration. Writes require SETTINGS_MANAGE explicitly: reading
 * readiness (REPORTS_READ) must never be enough to change activation.
 */
const approvalUseCases = () => {
  const registry = Registry.getInstance();
  const audit = new CreateAuditLogUseCase(registry.auditRepo);
  return {
    list: new ListModuleApprovalsUseCase(drizzleModuleApprovalRepository),
    approve: new ApproveModuleActivationUseCase(drizzleModuleApprovalRepository, audit),
    revoke: new RevokeModuleActivationUseCase(drizzleModuleApprovalRepository, audit),
  };
};

const failureStatus: Record<string, 400 | 404 | 409> = {
  UNKNOWN_MODULE: 404,
  MODULE_NOT_APPROVAL_GATED: 400,
  BAD_INPUT: 400,
  ALREADY_APPROVED: 409,
  NOT_APPROVED: 409,
};

/** GET /admin/control-centre/approvals */
routes.get('/approvals', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  try {
    const data = await approvalUseCases().list.execute();
    const res: ApiResponse<typeof data> = { success: true, data };
    return c.json(res, 200);
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      '[ControlCentre] approval listing failed',
    );
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'APPROVAL_LEDGER_UNAVAILABLE', message: 'Approvals could not be read.' },
    };
    return c.json(res, 503);
  }
});

/** POST /admin/control-centre/approvals — activate one approval-gated module. */
routes.post('/approvals', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const traceId = c.req.header('x-correlation-id') ?? crypto.randomUUID();
  const actorId = c.get('user')?.id;
  if (!actorId) {
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'UNAUTHENTICATED', message: 'No acting administrator on the session.' },
    };
    return c.json(res, 401);
  }

  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'BAD_INPUT', message: 'A JSON body is required.' },
    };
    return c.json(res, 400);
  }

  const result = await approvalUseCases().approve.execute({
    moduleKey: String((body as Record<string, unknown>).moduleKey ?? ''),
    reason: String((body as Record<string, unknown>).reason ?? ''),
    approvalReference: String((body as Record<string, unknown>).approvalReference ?? ''),
    actorId,
    traceId,
  });

  if (!result.ok) {
    const res: ApiResponse<never> = {
      success: false,
      error: { code: result.code, message: result.message },
    };
    return c.json(res, failureStatus[result.code] ?? 400);
  }
  const res: ApiResponse<typeof result.record> = { success: true, data: result.record };
  return c.json(res, 201);
});

/** POST /admin/control-centre/approvals/revoke — return a module to DORMANT. */
routes.post('/approvals/revoke', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const traceId = c.req.header('x-correlation-id') ?? crypto.randomUUID();
  const actorId = c.get('user')?.id;
  if (!actorId) {
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'UNAUTHENTICATED', message: 'No acting administrator on the session.' },
    };
    return c.json(res, 401);
  }

  const body = await c.req.json().catch(() => null);
  const result = await approvalUseCases().revoke.execute({
    moduleKey: String((body as Record<string, unknown> | null)?.moduleKey ?? ''),
    revocationReason: String((body as Record<string, unknown> | null)?.revocationReason ?? ''),
    actorId,
    traceId,
  });

  if (!result.ok) {
    const res: ApiResponse<never> = {
      success: false,
      error: { code: result.code, message: result.message },
    };
    return c.json(res, failureStatus[result.code] ?? 400);
  }
  const res: ApiResponse<typeof result.record> = { success: true, data: result.record };
  return c.json(res, 200);
});

export default routes;
