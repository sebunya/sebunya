import { Context, Next } from 'hono';
import { deploymentService } from '../../../infrastructure/deployment/DeploymentService';
import { ApiResponse } from '@goldplus/shared';
import { logger } from '../../../infrastructure/logging/logger';

/**
 * Writes that must keep working while the freeze is on.
 *
 * Beyond health/metrics and the deployment + queue controls, two families:
 *  - MONEY ALREADY TAKEN. A payment provider's notification (PesaPal IPN,
 *    payment webhooks) records a payment the customer has already made. A 503
 *    left a paid order unpaid until a retry or the reconcile sweep caught it.
 *  - GETTING BACK IN TO LIFT THE FREEZE. The flag is shared through Redis (it
 *    survives restarts) and only the deployment route clears it, so an operator
 *    whose session had expired could not sign in (or pass step-up) to turn it off.
 */
export function isMaintenanceExempt(path: string): boolean {
  return (
    path.startsWith('/health') ||
    path.startsWith('/metrics') ||
    path.includes('/admin/deployment') ||
    path.includes('/admin/queues') || // allow admin queue operations (e.g. replays)
    path.includes('/payments/pesapal/ipn') ||
    path.startsWith('/webhooks/') ||
    path === '/auth/login' ||
    path === '/auth/admin/login' ||
    path === '/auth/refresh' ||
    path === '/auth/mfa/verify'
  );
}

export async function maintenanceMode(c: Context, next: Next) {
  // Every replica reads the SAME flag (Redis, ~2s cache): a freeze used to reach
  // only the replica that took the admin POST.
  if (await deploymentService.refreshFlags()) {
    const method = c.req.method.toUpperCase();
    const isWriteOperation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

    const isExemptedRoute = isMaintenanceExempt(c.req.path);

    if (isWriteOperation && !isExemptedRoute) {
      logger.warn(
        { method, path: c.req.path, requestId: c.get('requestId') },
        '[MaintenanceMode] Blocked write operation during deployment freeze'
      );
      
      const res: ApiResponse<never> = {
        success: false,
        error: {
          code: 'SYSTEM_UNDER_MAINTENANCE',
          message: 'The system is temporarily undergoing maintenance. Write operations are frozen.',
        },
        meta: {
          requestId: c.get('requestId') as string,
        }
      };
      
      return c.json(res, 503);
    }
  }
  
  await next();
}
