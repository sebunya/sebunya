import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { Registry } from '../../infrastructure/Registry.js';

const router = new Hono();

router.post(
  '/',
  zValidator(
    'json',
    z.object({
      dryRunId: z.string(),
      activationRequestId: z.string(),
      canaryCap: z.number(),
      destinationAllowlist: z.array(z.string()),
      rollbackPlan: z.string(),
      monitoringOwner: z.string(),
      createdByAdminId: z.string()
    })
  ),
  async (c) => {
    const data = c.req.valid('json');
    const registry = Registry.getInstance();
    try {
      const canary = await registry.createControlledLiveCanaryUseCase.execute(data);
      return c.json({ success: true, canary });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: msg }, 400);
    }
  }
);

router.get(
  '/',
  async (c) => {
    const activationRequestId = c.req.query('activationRequestId');
    if (!activationRequestId) {
      return c.json({ success: false, error: 'MISSING_REQUEST_ID' }, 400);
    }
    const registry = Registry.getInstance();
    try {
      const canaries = await registry.listControlledLiveCanariesUseCase.execute(activationRequestId);
      return c.json({ success: true, canaries });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: msg }, 400);
    }
  }
);

router.get(
  '/:id',
  async (c) => {
    const canaryId = c.req.param('id');
    const registry = Registry.getInstance();
    try {
      const canary = await registry.getControlledLiveCanaryUseCase.execute(canaryId);
      return c.json({ success: true, canary });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: msg }, 400);
    }
  }
);

router.post(
  '/:id/eligibility',
  async (c) => {
    const canaryId = c.req.param('id');
    const registry = Registry.getInstance();
    try {
      const result = await registry.evaluateControlledLiveCanaryEligibilityUseCase.execute({ canaryId });
      return c.json({ success: true, ...result });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: msg }, 400);
    }
  }
);

router.post(
  '/:id/start',
  zValidator(
    'json',
    z.object({
      confirmationText: z.string(),
      startedByAdminId: z.string()
    })
  ),
  async (c) => {
    const canaryId = c.req.param('id');
    const data = c.req.valid('json');
    const registry = Registry.getInstance();
    try {
      const result = await registry.startControlledLiveCanaryUseCase.execute({
        canaryId,
        confirmationText: data.confirmationText,
        startedByAdminId: data.startedByAdminId
      });
      return c.json({ success: true, ...result });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: msg }, 400);
    }
  }
);

router.post(
  '/:id/pause',
  zValidator(
    'json',
    z.object({
      reason: z.string(),
      pausedByAdminId: z.string()
    })
  ),
  async (c) => {
    const canaryId = c.req.param('id');
    const data = c.req.valid('json');
    const registry = Registry.getInstance();
    try {
      const canary = await registry.pauseControlledLiveCanaryUseCase.execute({
        canaryId,
        reason: data.reason,
        pausedByAdminId: data.pausedByAdminId
      });
      return c.json({ success: true, canary });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: msg }, 400);
    }
  }
);

router.post(
  '/:id/rollback',
  zValidator(
    'json',
    z.object({
      reason: z.string(),
      rollbackOwner: z.string(),
      actorAdminId: z.string()
    })
  ),
  async (c) => {
    const canaryId = c.req.param('id');
    const data = c.req.valid('json');
    const registry = Registry.getInstance();
    try {
      const canary = await registry.rollbackControlledLiveCanaryUseCase.execute({
        canaryId,
        reason: data.reason,
        rollbackOwner: data.rollbackOwner,
        actorAdminId: data.actorAdminId
      });
      return c.json({ success: true, canary });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: msg }, 400);
    }
  }
);

router.post(
  '/:id/evidence-pack',
  async (c) => {
    const canaryId = c.req.param('id');
    const registry = Registry.getInstance();
    try {
      const evidencePack = await registry.buildControlledLiveCanaryEvidencePackUseCase.execute({ canaryId });
      return c.json({ success: true, evidencePack });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: msg }, 400);
    }
  }
);

router.post(
  '/:id/complete',
  zValidator(
    'json',
    z.object({
      completedByAdminId: z.string()
    })
  ),
  async (c) => {
    const canaryId = c.req.param('id');
    const data = c.req.valid('json');
    const registry = Registry.getInstance();
    try {
      const canary = await registry.completeControlledLiveCanaryUseCase.execute({
        canaryId,
        completedByAdminId: data.completedByAdminId
      });
      return c.json({ success: true, canary });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: msg }, 400);
    }
  }
);

export const controlledLiveCanaryRouter = router;
export default router;
