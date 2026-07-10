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
const dummyRoleRepo = {
  findPermissionsForUser: async () => ['settings.manage', 'reports.read']
};
const accessPolicy = new DefaultControlledActivationAccessPolicy(dummyRoleRepo);

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

const router = new Hono();

router.post(
  '/execution-plans',
  zValidator(
    'json',
    z.object({
      adminId: z.string(),
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
    const command = {
      ...data,
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
  zValidator(
    'json',
    z.object({
      adminId: z.string(),
      executionPlanId: z.string()
    })
  ),
  async (c) => {
    const data = c.req.valid('json');
    try {
      const dryRunId = await runDryRunUseCase.execute(data);
      return c.json({ success: true, dryRunId });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: msg }, 400);
    }
  }
);

router.post(
  '/dry-runs/:id/previews',
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
  zValidator(
    'json',
    z.object({
      adminId: z.string()
    })
  ),
  async (c) => {
    const executionPlanId = c.req.param('id');
    const data = c.req.valid('json');
    try {
      await markReadyUseCase.execute({ adminId: data.adminId, executionPlanId });
      return c.json({ success: true });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: msg }, 400);
    }
  }
);

router.post(
  '/dry-runs/:id/cancel',
  zValidator(
    'json',
    z.object({
      adminId: z.string(),
      reason: z.string()
    })
  ),
  async (c) => {
    const dryRunId = c.req.param('id');
    const data = c.req.valid('json');
    try {
      await cancelDryRunUseCase.execute({
        adminId: data.adminId,
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
