import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { Registry } from '../../infrastructure/Registry.js';
import { authMiddleware } from '../../interfaces/http/middleware/auth.js';
import { requirePermissions } from '../../interfaces/http/middleware/permissions.js';
import { PERMISSIONS } from '@goldplus/shared';

const router = new Hono<{ Variables: { user?: { id: string; email: string; permissions: string[] } } }>();

// This router is mounted under /admin. It governs controlled live canaries, which are a
// customer-facing activation primitive, so every endpoint is authenticated and RBAC-gated.
// Acting-admin identity is always derived from the session, never from the request body.
router.use('*', authMiddleware);

const actingAdminId = (c: { get: (k: 'user') => { id: string } | undefined }): string | null =>
  c.get('user')?.id ?? null;

router.post(
  '/',
  requirePermissions([PERMISSIONS.SETTINGS_MANAGE]),
  zValidator(
    'json',
    z.object({
      dryRunId: z.string(),
      activationRequestId: z.string(),
      canaryCap: z.number(),
      destinationAllowlist: z.array(z.string()),
      rollbackPlan: z.string(),
      monitoringOwner: z.string(),
      createdByAdminId: z.string().optional()
    })
  ),
  async (c) => {
    const data = c.req.valid('json');
    const admin = actingAdminId(c);
    if (!admin) return c.json({ success: false, error: 'UNAUTHENTICATED' }, 401);
    const registry = Registry.getInstance();
    try {
      const canary = await registry.createControlledLiveCanaryUseCase.execute({ ...data, createdByAdminId: admin });
      return c.json({ success: true, canary });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return c.json({ success: false, error: msg }, 400);
    }
  }
);

router.get(
  '/',
  requirePermissions([PERMISSIONS.REPORTS_READ]),
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
  requirePermissions([PERMISSIONS.REPORTS_READ]),
  async (c) => {
    const canaryId = c.req.param('id');
    if (!canaryId) return c.json({ success: false, error: 'MISSING_CANARY_ID' }, 400);
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
  requirePermissions([PERMISSIONS.REPORTS_READ]),
  async (c) => {
    const canaryId = c.req.param('id');
    if (!canaryId) return c.json({ success: false, error: 'MISSING_CANARY_ID' }, 400);
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
  requirePermissions([PERMISSIONS.SETTINGS_MANAGE]),
  zValidator(
    'json',
    z.object({
      confirmationText: z.string(),
      startedByAdminId: z.string().optional()
    })
  ),
  async (c) => {
    const canaryId = c.req.param('id');
    if (!canaryId) return c.json({ success: false, error: 'MISSING_CANARY_ID' }, 400);
    const data = c.req.valid('json');
    const admin = actingAdminId(c);
    if (!admin) return c.json({ success: false, error: 'UNAUTHENTICATED' }, 401);
    const registry = Registry.getInstance();
    try {
      const result = await registry.startControlledLiveCanaryUseCase.execute({
        canaryId,
        confirmationText: data.confirmationText,
        startedByAdminId: admin
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
  requirePermissions([PERMISSIONS.SETTINGS_MANAGE]),
  zValidator(
    'json',
    z.object({
      reason: z.string(),
      pausedByAdminId: z.string().optional()
    })
  ),
  async (c) => {
    const canaryId = c.req.param('id');
    if (!canaryId) return c.json({ success: false, error: 'MISSING_CANARY_ID' }, 400);
    const data = c.req.valid('json');
    const admin = actingAdminId(c);
    if (!admin) return c.json({ success: false, error: 'UNAUTHENTICATED' }, 401);
    const registry = Registry.getInstance();
    try {
      const canary = await registry.pauseControlledLiveCanaryUseCase.execute({
        canaryId,
        reason: data.reason,
        pausedByAdminId: admin
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
  requirePermissions([PERMISSIONS.SETTINGS_MANAGE]),
  zValidator(
    'json',
    z.object({
      reason: z.string(),
      rollbackOwner: z.string(),
      actorAdminId: z.string().optional()
    })
  ),
  async (c) => {
    const canaryId = c.req.param('id');
    if (!canaryId) return c.json({ success: false, error: 'MISSING_CANARY_ID' }, 400);
    const data = c.req.valid('json');
    const admin = actingAdminId(c);
    if (!admin) return c.json({ success: false, error: 'UNAUTHENTICATED' }, 401);
    const registry = Registry.getInstance();
    try {
      const canary = await registry.rollbackControlledLiveCanaryUseCase.execute({
        canaryId,
        reason: data.reason,
        rollbackOwner: data.rollbackOwner,
        actorAdminId: admin
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
  requirePermissions([PERMISSIONS.REPORTS_READ]),
  async (c) => {
    const canaryId = c.req.param('id');
    if (!canaryId) return c.json({ success: false, error: 'MISSING_CANARY_ID' }, 400);
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
  requirePermissions([PERMISSIONS.SETTINGS_MANAGE]),
  zValidator(
    'json',
    z.object({
      completedByAdminId: z.string().optional()
    })
  ),
  async (c) => {
    const canaryId = c.req.param('id');
    if (!canaryId) return c.json({ success: false, error: 'MISSING_CANARY_ID' }, 400);
    const data = c.req.valid('json');
    const admin = actingAdminId(c);
    if (!admin) return c.json({ success: false, error: 'UNAUTHENTICATED' }, 401);
    const registry = Registry.getInstance();
    try {
      const canary = await registry.completeControlledLiveCanaryUseCase.execute({
        canaryId,
        completedByAdminId: admin
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
