import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { db } from '../../infrastructure/db/client.js';
import { DrizzleControlledActivationExecutionPlanRepository } from '../../infrastructure/activation/DrizzleControlledActivationExecutionPlanRepository.js';
import { DrizzleControlledActivationDryRunRepository } from '../../infrastructure/activation/DrizzleControlledActivationDryRunRepository.js';
import { DefaultControlledActivationPayloadPreviewer } from '../../infrastructure/activation/DefaultControlledActivationPayloadPreviewer.js';
import { DefaultControlledActivationCanaryPlanner } from '../../infrastructure/activation/DefaultControlledActivationCanaryPlanner.js';
import { DefaultControlledActivationEvidencePackBuilder } from '../../infrastructure/activation/DefaultControlledActivationEvidencePackBuilder.js';
import { DrizzleControlledActivationAuditRepository } from '../../infrastructure/activation/DrizzleControlledActivationAuditRepository.js';
import { SafeControlledActivationReadinessChecker } from '../../infrastructure/activation/SafeControlledActivationReadinessChecker.js';
import { DefaultControlledActivationAccessPolicy } from '../../infrastructure/activation/DefaultControlledActivationAccessPolicy.js';
import { DrizzleControlledActivationRepository } from '../../infrastructure/activation/DrizzleControlledActivationRepository.js';
import { DrizzleRoleRepository } from '../../infrastructure/db/repositories/DrizzleRoleRepository.js';
import { authMiddleware } from '../../interfaces/http/middleware/auth.js';
import { requirePermissions } from '../../interfaces/http/middleware/permissions.js';
import { PERMISSIONS } from '@goldplus/shared';

import { CreateControlledActivationExecutionPlanUseCase } from '../../application/use-cases/activation/CreateControlledActivationExecutionPlanUseCase.js';
import { RunControlledActivationDryRunUseCase } from '../../application/use-cases/activation/RunControlledActivationDryRunUseCase.js';
import { GenerateDestinationPayloadPreviewsUseCase } from '../../application/use-cases/activation/GenerateDestinationPayloadPreviewsUseCase.js';
import { ValidateControlledActivationCanaryPlanUseCase } from '../../application/use-cases/activation/ValidateControlledActivationCanaryPlanUseCase.js';
import { BuildControlledActivationEvidencePackUseCase } from '../../application/use-cases/activation/BuildControlledActivationEvidencePackUseCase.js';
import { MarkActivationReadyForLiveReviewUseCase } from '../../application/use-cases/activation/MarkActivationReadyForLiveReviewUseCase.js';
import { CancelControlledActivationDryRunUseCase } from '../../application/use-cases/activation/CancelControlledActivationDryRunUseCase.js';

const executionPlanRepo = new DrizzleControlledActivationExecutionPlanRepository();
const dryRunRepo = new DrizzleControlledActivationDryRunRepository();
const payloadPreviewer = new DefaultControlledActivationPayloadPreviewer();
const canaryPlanner = new DefaultControlledActivationCanaryPlanner();
const evidencePackBuilder = new DefaultControlledActivationEvidencePackBuilder();
const auditRepo = new DrizzleControlledActivationAuditRepository();
const readinessChecker = new SafeControlledActivationReadinessChecker();
// The access policy must resolve real per-user permissions. A stub that returns a fixed
// permission set would grant every caller settings.manage and reports.read.
const accessPolicy = new DefaultControlledActivationAccessPolicy(new DrizzleRoleRepository());

const activationRepo = new DrizzleControlledActivationRepository();
const createExecutionPlanUseCase = new CreateControlledActivationExecutionPlanUseCase(executionPlanRepo, activationRepo, readinessChecker, accessPolicy, auditRepo);
const runDryRunUseCase = new RunControlledActivationDryRunUseCase(dryRunRepo, executionPlanRepo, accessPolicy, auditRepo, payloadPreviewer);
const generatePreviewsUseCase = new GenerateDestinationPayloadPreviewsUseCase(payloadPreviewer);
const validateCanaryPlanUseCase = new ValidateControlledActivationCanaryPlanUseCase(canaryPlanner);
const buildEvidencePackUseCase = new BuildControlledActivationEvidencePackUseCase(evidencePackBuilder, dryRunRepo);
const markReadyUseCase = new MarkActivationReadyForLiveReviewUseCase(
  executionPlanRepo,
  dryRunRepo,
  evidencePackBuilder,
  payloadPreviewer,
  readinessChecker
);
const cancelDryRunUseCase = new CancelControlledActivationDryRunUseCase(dryRunRepo, executionPlanRepo, auditRepo);

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
      const planId = await createExecutionPlanUseCase.execute(command);
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
      const dryRunId = await runDryRunUseCase.execute({ ...data, adminId: admin });
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
      const previews = await generatePreviewsUseCase.execute(dryRunId, data.activationRequestId);
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
      const result = await validateCanaryPlanUseCase.execute(data);
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
      const evidencePack = await buildEvidencePackUseCase.execute(dryRunId, data.activationRequestId);
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
      await markReadyUseCase.execute({ adminId: admin, executionPlanId });
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
      await cancelDryRunUseCase.execute({
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
