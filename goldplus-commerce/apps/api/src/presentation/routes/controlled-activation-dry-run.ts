import { Hono } from 'hono';
import { Registry } from '../../infrastructure/Registry.js';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { db } from '../../infrastructure/db/client.js';
import { authMiddleware } from '../../interfaces/http/middleware/auth.js';
import { requirePermissions } from '../../interfaces/http/middleware/permissions.js';
import { PERMISSIONS } from '@goldplus/shared';

import { MarkActivationReadyForLiveReviewUseCase } from '../../application/use-cases/activation/MarkActivationReadyForLiveReviewUseCase.js';

// ONE set of activation services per process: the Registry's. This route used to
// build private copies, and the in-memory canary planner it created was a different
// object from the one live review reads — a canary plan validated here could never
// be found there, so readiness checks and runbooks always failed with "Canary plan is
// missing" (found by driving the live-review page end to end, 2026-09-23).
// Resolved lazily, like the other routes, so importing this module builds nothing.
let services: ReturnType<typeof buildServices> | null = null;
function buildServices() {
  const r = Registry.getInstance();
  return {
    createExecutionPlanUseCase: r.createControlledActivationExecutionPlanUseCase,
    runDryRunUseCase: r.runControlledActivationDryRunUseCase,
    generatePreviewsUseCase: r.generateDestinationPayloadPreviewsUseCase,
    validateCanaryPlanUseCase: r.validateControlledActivationCanaryPlanUseCase,
    buildEvidencePackUseCase: r.buildControlledActivationEvidencePackUseCase,
    cancelDryRunUseCase: r.cancelControlledActivationDryRunUseCase,
    markReadyUseCase: new MarkActivationReadyForLiveReviewUseCase(
      r.controlledActivationExecutionPlanRepo,
      r.controlledActivationDryRunRepo,
      r.controlledActivationEvidencePackBuilder,
      r.controlledActivationPayloadPreviewer,
      r.controlledActivationReadinessChecker,
    ),
  };
}
const svc = () => (services ??= buildServices());

const router = new Hono<{ Variables: { user?: { id: string; email: string; permissions: string[] } } }>();

// Mounted under /admin: authenticate every request and derive the acting admin from the
// session rather than from the request body.
router.use('*', authMiddleware);

const actingAdminId = (c: { get: (k: 'user') => { id: string } | undefined }): string | null =>
  c.get('user')?.id ?? null;

router.post(
  '/execution-plans',
  requirePermissions([PERMISSIONS.SETTINGS_MANAGE]),
  zValidator(
    'json',
    z.object({
      adminId: z.string().optional(),
      activationRequestId: z.string(),
      activationScope: z.string(),
      environment: z.string(),
      requestedWindowStart: z.string().optional(),
      requestedWindowEnd: z.string().optional(),
      canaryScopeSummary: z.string().optional(),
      rollbackPlanSummary: z.string().optional(),
      monitoringOwner: z.string().optional()
    })
  ),
  async (c) => {
    const data = c.req.valid('json');
    const admin = actingAdminId(c);
    if (!admin) return c.json({ success: false, error: 'UNAUTHENTICATED' }, 401);
    const command = {
      ...data,
      adminId: admin,
      requestedWindowStart: data.requestedWindowStart ? new Date(data.requestedWindowStart) : undefined,
      requestedWindowEnd: data.requestedWindowEnd ? new Date(data.requestedWindowEnd) : undefined,
      canaryScopeSummary: data.canaryScopeSummary || '',
      rollbackPlanSummary: data.rollbackPlanSummary || '',
      monitoringOwner: data.monitoringOwner || ''
    };

    try {
      const planId = await svc().createExecutionPlanUseCase.execute(command);
      return c.json({ success: true, executionPlanId: planId });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: msg }, 400);
    }
  }
);

router.post(
  '/dry-runs',
  requirePermissions([PERMISSIONS.SETTINGS_MANAGE]),
  zValidator(
    'json',
    z.object({
      adminId: z.string().optional(),
      executionPlanId: z.string()
    })
  ),
  async (c) => {
    const data = c.req.valid('json');
    const admin = actingAdminId(c);
    if (!admin) return c.json({ success: false, error: 'UNAUTHENTICATED' }, 401);
    try {
      const dryRunId = await svc().runDryRunUseCase.execute({ ...data, adminId: admin });
      return c.json({ success: true, dryRunId });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: msg }, 400);
    }
  }
);

router.post(
  '/dry-runs/:id/previews',
  requirePermissions([PERMISSIONS.REPORTS_READ]),
  zValidator(
    'json',
    z.object({
      activationRequestId: z.string()
    })
  ),
  async (c) => {
    const dryRunId = c.req.param('id');
    const data = c.req.valid('json');
    try {
      const previews = await svc().generatePreviewsUseCase.execute(dryRunId, data.activationRequestId);
      return c.json({ success: true, previews });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: msg }, 400);
    }
  }
);

router.post(
  '/canary-plans/validate',
  requirePermissions([PERMISSIONS.REPORTS_READ]),
  zValidator(
    'json',
    z.object({
      executionPlanId: z.string(),
      scopeSummary: z.string(),
      percentageCap: z.number()
    })
  ),
  async (c) => {
    const data = c.req.valid('json');
    try {
      const result = await svc().validateCanaryPlanUseCase.execute(data);
      return c.json(result);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: msg }, 400);
    }
  }
);

router.post(
  '/dry-runs/:id/evidence',
  requirePermissions([PERMISSIONS.REPORTS_READ]),
  zValidator(
    'json',
    z.object({
      activationRequestId: z.string()
    })
  ),
  async (c) => {
    const dryRunId = c.req.param('id');
    const data = c.req.valid('json');
    try {
      const evidencePack = await svc().buildEvidencePackUseCase.execute(dryRunId, data.activationRequestId);
      return c.json({ success: true, evidencePack });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: msg }, 400);
    }
  }
);

router.post(
  '/execution-plans/:id/ready-for-review',
  requirePermissions([PERMISSIONS.SETTINGS_MANAGE]),
  zValidator(
    'json',
    z.object({
      adminId: z.string().optional()
    })
  ),
  async (c) => {
    const executionPlanId = c.req.param('id');
    const data = c.req.valid('json');
    const admin = actingAdminId(c);
    if (!admin) return c.json({ success: false, error: 'UNAUTHENTICATED' }, 401);
    try {
      await svc().markReadyUseCase.execute({ adminId: admin, executionPlanId });
      return c.json({ success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: msg }, 400);
    }
  }
);

router.post(
  '/dry-runs/:id/cancel',
  requirePermissions([PERMISSIONS.SETTINGS_MANAGE]),
  zValidator(
    'json',
    z.object({
      adminId: z.string().optional(),
      reason: z.string()
    })
  ),
  async (c) => {
    const dryRunId = c.req.param('id');
    const data = c.req.valid('json');
    const admin = actingAdminId(c);
    if (!admin) return c.json({ success: false, error: 'UNAUTHENTICATED' }, 401);
    try {
      await svc().cancelDryRunUseCase.execute({
        adminId: admin,
        dryRunId,
        reason: data.reason
      });
      return c.json({ success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: msg }, 400);
    }
  }
);

export const controlledActivationDryRunRouter = router;
