import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions.js';
import { PERMISSIONS } from '@goldplus/shared';
import { Registry } from '../../../../infrastructure/Registry.js';
const registry = Registry.getInstance();
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';

export const controlledActivationRoutes = new Hono<{ Variables: { user?: { id: string; email: string; permissions: string[] } } }>();

controlledActivationRoutes.use('*', authMiddleware);

controlledActivationRoutes.get('/summary', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const user = c.get('user');
  if (!user?.id) return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Missing admin identity' } }, 401);
  const summary = await registry.getControlledActivationSummaryUseCase.execute(user.id);
  return c.json(summary);
});

controlledActivationRoutes.get('/requests', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const user = c.get('user');
  if (!user?.id) return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Missing admin identity' } }, 401);
  const requests = await registry.listControlledActivationRequestsUseCase.execute(user.id);
  return c.json(requests.map((r: Parameters<typeof registry.controlledActivationMapper.toPublicDto>[0]) => registry.controlledActivationMapper.toPublicDto(r)));
});

controlledActivationRoutes.post('/requests', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), zValidator('json', z.object({
  activationName: z.string().min(1),
  activationScope: z.enum(['GTM_DRAFT_READINESS', 'PAID_SOCIAL_DESTINATION_READINESS', 'PRODUCT_FINDER_MEASUREMENT_READINESS', 'PREFERENCE_AND_CONSENT_READINESS', 'PESAPAL_PURCHASE_MEASUREMENT_READINESS', 'ADMIN_MONITORING_READINESS', 'RELEASE_READINESS_REVIEW', 'FULL_MEASUREMENT_STACK_REVIEW']),
  environment: z.enum(['LOCAL', 'STAGING', 'PRODUCTION_REVIEW', 'PRODUCTION_CONTROLLED_ACTIVATION_PENDING']),
  requestedWindowStart: z.string().datetime().optional(),
  requestedWindowEnd: z.string().datetime().optional(),
  reason: z.string().min(1),
  canaryScope: z.string().optional(),
  rollbackPlanSummary: z.string().min(1),
  monitoringOwner: z.string().min(1),
  riskLevel: z.string().optional()
})), async (c) => {
  const user = c.get('user');
  if (!user?.id) return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Missing admin identity' } }, 401);
  const body = c.req.valid('json');
  const request = await registry.createControlledActivationRequestUseCase.execute({
    adminId: user.id,
    activationName: body.activationName,
    activationScope: body.activationScope,
    environment: body.environment,
    requestedWindowStart: body.requestedWindowStart ? new Date(body.requestedWindowStart) : undefined,
    requestedWindowEnd: body.requestedWindowEnd ? new Date(body.requestedWindowEnd) : undefined,
    reason: body.reason,
    canaryScope: body.canaryScope,
    rollbackPlanSummary: body.rollbackPlanSummary,
    monitoringOwner: body.monitoringOwner,
    riskLevel: body.riskLevel
  });
  return c.json(registry.controlledActivationMapper.toPublicDto(request), 201);
});

controlledActivationRoutes.get('/requests/:requestId', requirePermissions([PERMISSIONS.REPORTS_READ]), async (c) => {
  const user = c.get('user');
  if (!user?.id) return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Missing admin identity' } }, 401);
  const request = await registry.getControlledActivationRequestUseCase.execute(user.id, c.req.param('requestId'));
  return c.json(registry.controlledActivationMapper.toPublicDto(request));
});

controlledActivationRoutes.post('/requests/:requestId/checks', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const user = c.get('user');
  if (!user?.id) return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Missing admin identity' } }, 401);
  const gates = await registry.runControlledActivationReadinessChecksUseCase.execute({
    adminId: user.id,
    activationRequestId: c.req.param('requestId')
  });
  return c.json(gates);
});

controlledActivationRoutes.post('/requests/:requestId/approve', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), zValidator('json', z.object({
  approvalNote: z.string().min(1)
})), async (c) => {
  const user = c.get('user');
  if (!user?.id) return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Missing admin identity' } }, 401);
  const body = c.req.valid('json');
  await registry.recordControlledActivationApprovalUseCase.execute({
    adminId: user.id,
    activationRequestId: c.req.param('requestId'),
    approvalNote: body.approvalNote
  });
  return c.json({ success: true });
});

controlledActivationRoutes.post('/requests/:requestId/reject', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), zValidator('json', z.object({
  reason: z.string().min(1)
})), async (c) => {
  const user = c.get('user');
  if (!user?.id) return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Missing admin identity' } }, 401);
  const body = c.req.valid('json');
  await registry.rejectControlledActivationRequestUseCase.execute({
    adminId: user.id,
    activationRequestId: c.req.param('requestId'),
    reason: body.reason
  });
  return c.json({ success: true });
});

controlledActivationRoutes.post('/requests/:requestId/cancel', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), zValidator('json', z.object({
  reason: z.string().min(1)
})), async (c) => {
  const user = c.get('user');
  if (!user?.id) return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Missing admin identity' } }, 401);
  const body = c.req.valid('json');
  await registry.cancelControlledActivationRequestUseCase.execute({
    adminId: user.id,
    activationRequestId: c.req.param('requestId'),
    reason: body.reason
  });
  return c.json({ success: true });
});

controlledActivationRoutes.post('/requests/:requestId/blockers/:gateId/acknowledge', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), zValidator('json', z.object({
  reason: z.string().min(1)
})), async (c) => {
  const user = c.get('user');
  if (!user?.id) return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Missing admin identity' } }, 401);
  const body = c.req.valid('json');
  await registry.acknowledgeActivationBlockerUseCase.execute({
    adminId: user.id,
    activationRequestId: c.req.param('requestId'),
    gateId: c.req.param('gateId'),
    reason: body.reason
  });
  return c.json({ success: true });
});
