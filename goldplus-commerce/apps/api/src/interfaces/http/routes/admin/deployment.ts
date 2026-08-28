import { Hono } from 'hono';
import { deploymentService } from '../../../../infrastructure/deployment/DeploymentService';
import { ApiResponse, PERMISSIONS } from '@goldplus/shared';
import { authMiddleware } from '../../middleware/auth';
import { requirePermissions } from '../../middleware/permissions';
import { Registry } from '../../../../infrastructure/Registry';

/** Who did it, on a site-wide operational change. */
const audit = (c: { get(k: string): unknown }, action: string, newState: Record<string, unknown>) =>
  Registry.getInstance().createAuditLogUseCase.execute({
    actorId: (c.get('user') as { id?: string } | undefined)?.id ?? 'unknown',
    action,
    entity: 'deployment',
    entityId: 'global',
    newState,
  }).catch(() => undefined);

// Maintenance mode, health score and shadow traffic are site-wide operational
// mutations. They used to carry an audit exemption that was not true:
// DeploymentService logs the new VALUE without the actor, and logs nothing at
// all for shadow traffic, so afterwards nobody could say who took the site
// down. Each handler now records the actor, as the queue routes do.
const routes = new Hono();

// Enforce auth globally for all deployment admin actions
routes.use('*', authMiddleware);

/**
 * GET /admin/deployment/status
 * Get the current deployment settings (maintenance mode, health score, shadow ratio)
 */
routes.get('/status', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const res: ApiResponse<{
    maintenanceMode: boolean;
    healthScore: number;
    shadowRatio: number;
    shadowUrl: string;
    shadowConfigured: boolean;
  }> = {
    success: true,
    data: {
      maintenanceMode: deploymentService.getMaintenanceMode(),
      healthScore: deploymentService.getReleaseHealthScore(),
      shadowRatio: deploymentService.getShadowTrafficRatio(),
      shadowUrl: deploymentService.getShadowUrl(),
      shadowConfigured: deploymentService.hasShadowTarget(),
    },
  };
  return c.json(res, 200);
});

/**
 * POST /admin/deployment/maintenance
 * Toggle maintenance mode
 */
routes.post('/maintenance', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const enabled = body?.enabled;

  if (typeof enabled !== 'boolean') {
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'INVALID_PARAMETER', message: 'Parameter "enabled" must be a boolean.' },
    };
    return c.json(res, 400);
  }

  const wasEnabled = deploymentService.getMaintenanceMode();
  deploymentService.setMaintenanceMode(enabled);
  await audit(c, 'DEPLOYMENT_MAINTENANCE_MODE_SET', { enabled, previous: wasEnabled });

  const res: ApiResponse<{ maintenanceMode: boolean }> = {
    success: true,
    data: { maintenanceMode: deploymentService.getMaintenanceMode() },
  };
  return c.json(res, 200);
});

/**
 * POST /admin/deployment/health-score
 * Set current release health score
 */
routes.post('/health-score', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const score = Number(body?.score);

  if (isNaN(score) || score < 0 || score > 100) {
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'INVALID_PARAMETER', message: 'Score must be a number between 0 and 100.' },
    };
    return c.json(res, 400);
  }

  deploymentService.updateHealthScore(score);
  await audit(c, 'DEPLOYMENT_HEALTH_SCORE_SET', { score });

  const res: ApiResponse<{ healthScore: number }> = {
    success: true,
    data: { healthScore: deploymentService.getReleaseHealthScore() },
  };
  return c.json(res, 200);
});

/**
 * POST /admin/deployment/shadow-traffic
 * Set shadow traffic ratio
 */
routes.post('/shadow-traffic', requirePermissions([PERMISSIONS.SETTINGS_MANAGE]), async (c) => {
  const body = await c.req.json().catch(() => null);
  const ratio = Number(body?.ratio);
  const shadowUrl = typeof body?.shadowUrl === 'string' ? body.shadowUrl : undefined;

  if (isNaN(ratio) || ratio < 0 || ratio > 1) {
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'INVALID_PARAMETER', message: 'Ratio must be a number between 0 and 1.' },
    };
    return c.json(res, 400);
  }

  if (shadowUrl !== undefined && !deploymentService.setShadowUrl(shadowUrl || null)) {
    const res: ApiResponse<never> = {
      success: false,
      error: { code: 'INVALID_SHADOW_URL', message: 'Shadow URL must be a valid http(s) URL.' },
    };
    return c.json(res, 400);
  }

  if (ratio > 0 && !deploymentService.hasShadowTarget()) {
    const res: ApiResponse<never> = {
      success: false,
      error: {
        code: 'SHADOW_TARGET_REQUIRED',
        message: 'Configure SHADOW_TRAFFIC_URL or pass "shadowUrl" before enabling shadow traffic.',
      },
    };
    return c.json(res, 400);
  }

  deploymentService.setShadowTrafficRatio(ratio);
  await audit(c, 'DEPLOYMENT_SHADOW_TRAFFIC_SET', { ratio, shadowUrl: shadowUrl ?? null });

  const res: ApiResponse<{ shadowRatio: number; shadowUrl: string; shadowConfigured: boolean }> = {
    success: true,
    data: {
      shadowRatio: deploymentService.getShadowTrafficRatio(),
      shadowUrl: deploymentService.getShadowUrl(),
      shadowConfigured: deploymentService.hasShadowTarget(),
    },
  };
  return c.json(res, 200);
});

export default routes;
